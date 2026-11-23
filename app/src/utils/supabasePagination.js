// ============================================================================
// Paginación robusta y lectura Keyset O(log N) para consultas Supabase / PostgREST
// - Evita el límite por defecto `max_rows = 1000` sin saltos ni truncamientos.
// - Soporta lectura ultrarrápida por RPC Keyset JSONB (hasta 5,000 filas/petición)
//   particionada en buckets UUID paralelos (sin OFFSET O(N²) ni timeouts).
// - Fallback automático sin migración usando Keyset sobre el índice único
//   (periodo_id, car_sunat) para lotes masivos y paginación paralela en lotes pequeños.
// - Soporta cancelación inmediata mediante AbortSignal y reporte de progreso.
// ============================================================================
import { executeParallelBatches } from './jobQueue.js';

export const SUPABASE_MAX_SELECT_ROWS = 1000;
export const SUPABASE_KEYSET_RPC_LIMIT = 5000;

export const UUID_BUCKETS_4 = [
  { minId: '00000000-0000-0000-0000-000000000000', maxId: '3fffffff-ffff-ffff-ffff-ffffffffffff' },
  { minId: '40000000-0000-0000-0000-000000000000', maxId: '7fffffff-ffff-ffff-ffff-ffffffffffff' },
  { minId: '80000000-0000-0000-0000-000000000000', maxId: 'bfffffff-ffff-ffff-ffff-ffffffffffff' },
  { minId: 'c0000000-0000-0000-0000-000000000000', maxId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
];

export const UUID_BUCKETS_2 = [
  { minId: '00000000-0000-0000-0000-000000000000', maxId: '7fffffff-ffff-ffff-ffff-ffffffffffff' },
  { minId: '80000000-0000-0000-0000-000000000000', maxId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
];

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new DOMException('Operación cancelada.', 'AbortError');
  }
}

export function esRpcFaltanteError(err) {
  if (!err) return false;
  const msg = String(err.message || '');
  return (
    err.code === '42883' ||
    err.code === 'PGRST202' ||
    msg.includes('Could not find the function') ||
    msg.includes('does not exist')
  );
}

export function esErrorLecturaReintentable(err) {
  if (!err || err.name === 'AbortError') return false;
  const code = String(err.code || '');
  const msg = String(err.message || '').toLowerCase();
  return (
    code === '57014' ||
    code === '53300' ||
    code === '08006' ||
    msg.includes('statement timeout') ||
    msg.includes('canceling statement') ||
    msg.includes('timeout') ||
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504')
  );
}

async function esperarMs(ms, signal) {
  throwIfAborted(signal);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Operación cancelada.', 'AbortError'));
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Descarga todas las filas de una consulta Supabase paginada por rangos.
 *
 * @param {object} options
 * @param {(from: number, to: number, withCount: boolean) => Promise<{ data: any[], count?: number|null, error: any }>} options.fetchPage
 * @param {number} [options.pageSize=1000] Tamaño preferido de página (acotado a 1000).
 * @param {number} [options.concurrency=4] Concurrencia máxima para páginas paralelas.
 * @param {string} [options.label='SupabasePage'] Etiqueta para telemetría.
 * @param {(loaded: number, total: number) => void} [options.onProgress] Callback opcional de progreso.
 * @param {AbortSignal} [options.signal] Señal opcional de cancelación.
 * @returns {Promise<any[]>}
 */
export async function fetchAllSupabasePages({
  fetchPage,
  pageSize = SUPABASE_MAX_SELECT_ROWS,
  concurrency = 4,
  label = 'SupabasePage',
  onProgress,
  signal,
}) {
  throwIfAborted(signal);
  const requestedPageSize = Math.max(
    1,
    Math.min(pageSize || SUPABASE_MAX_SELECT_ROWS, SUPABASE_MAX_SELECT_ROWS)
  );

  // 1. Primera página con conteo exacto
  const { data: firstPage, count, error } = await fetchPage(0, requestedPageSize - 1, true);
  throwIfAborted(signal);
  if (error) throw error;
  if (!firstPage || firstPage.length === 0) {
    if (onProgress) onProgress(0, 0);
    return [];
  }

  const hasExactCount = typeof count === 'number' && Number.isFinite(count);
  const total = hasExactCount ? count : firstPage.length;
  if (onProgress) onProgress(firstPage.length, Math.max(total, firstPage.length));

  // Caso A: Todas las filas entraron en la primera página
  if (hasExactCount && firstPage.length >= total) {
    return firstPage;
  }

  const step = firstPage.length;

  // Caso B: Tenemos el total exacto y faltan páginas -> descarga paralela controlada
  if (hasExactCount && total > step) {
    const offsets = [];
    for (let from = step; from < total; from += step) {
      offsets.push(from);
    }

    let loaded = firstPage.length;
    const pagesResults = await executeParallelBatches(
      offsets,
      1,
      async ([from]) => {
        throwIfAborted(signal);
        const to = Math.min(from + step - 1, total - 1);
        const res = await fetchPage(from, to, false);
        throwIfAborted(signal);
        if (res.error) throw res.error;
        const rows = res.data || [];
        loaded += rows.length;
        if (onProgress) onProgress(Math.min(loaded, total), total);
        return rows;
      },
      { concurrency, label, signal }
    );

    const all = [...firstPage];
    for (const chunk of pagesResults) {
      if (chunk && chunk.length > 0) {
        for (let i = 0; i < chunk.length; i++) {
          all.push(chunk[i]);
        }
      }
    }
    return all;
  }

  // Caso C: Sin `count` exacto -> continuar secuencialmente mientras lleguen páginas completas
  if (!hasExactCount && firstPage.length === requestedPageSize) {
    const all = [...firstPage];
    let from = step;
    while (true) {
      throwIfAborted(signal);
      const res = await fetchPage(from, from + step - 1, false);
      throwIfAborted(signal);
      if (res.error) throw res.error;
      const rows = res.data || [];
      if (rows.length === 0) break;
      for (let i = 0; i < rows.length; i++) {
        all.push(rows[i]);
      }
      if (onProgress) onProgress(all.length, all.length);
      if (rows.length < step) break;
      from += rows.length;
    }
    return all;
  }

  return firstPage;
}

/**
 * Descarga todas las filas de un período evitando el escaneo cuadrático O(N²) de OFFSET:
 * 1. Vía rápida: RPC Keyset JSONB en 4 (o 2) buckets UUID paralelos de hasta 5,000 filas/petición.
 * 2. Fallback automático (si la RPC aún no se ha migrado en Supabase):
 *    - Lotes pequeños (<= 8,000 filas): paginación paralela de 1,000 filas.
 *    - Lotes grandes (> 8,000 filas): paginación Keyset O(log N) sobre `car_sunat` + filas NULL.
 */
export async function fetchAllSupabaseKeyset({
  fetchCount,
  fetchRpcBatch,
  fetchCarKeysetPage,
  fetchNullCarPage,
  fetchOffsetPage,
  pageSize = SUPABASE_MAX_SELECT_ROWS,
  rpcLimit = SUPABASE_KEYSET_RPC_LIMIT,
  concurrency = 4,
  label = 'SupabaseKeyset',
  onProgress,
  signal,
}) {
  throwIfAborted(signal);

  const safePageSize = Math.max(100, Math.min(pageSize || SUPABASE_MAX_SELECT_ROWS, SUPABASE_MAX_SELECT_ROWS));
  const safeRpcLimit = Math.max(500, Math.min(rpcLimit || SUPABASE_KEYSET_RPC_LIMIT, SUPABASE_KEYSET_RPC_LIMIT));

  // 1. Obtener conteo total exacto rápidamente (head: true) para elegir estrategia óptima y reportar progreso
  let total = null;
  if (typeof fetchCount === 'function') {
    const countRes = await fetchCount();
    throwIfAborted(signal);
    if (!countRes?.error && typeof countRes?.count === 'number' && Number.isFinite(countRes.count)) {
      total = countRes.count;
      if (total === 0) {
        if (onProgress) onProgress(0, 0);
        return [];
      }
      if (onProgress) onProgress(0, total);
    }
  }

  // 2. Vía rápida: RPC Keyset JSONB (hasta 5,000 filas/petición, 0 OFFSET)
  if (typeof fetchRpcBatch === 'function') {
    const runRpcWithRetry = async ({ minId, maxId, afterId, limit }) => {
      let currentLimit = limit;
      for (let attempt = 0; attempt <= 2; attempt++) {
        throwIfAborted(signal);
        const res = await fetchRpcBatch({ minId, maxId, afterId, limit: currentLimit });
        throwIfAborted(signal);
        if (!res.error) {
          return { rows: Array.isArray(res.data) ? res.data : [], usedLimit: currentLimit };
        }
        if (esRpcFaltanteError(res.error)) {
          return { rpcMissing: true };
        }
        if (esErrorLecturaReintentable(res.error) && attempt < 2) {
          currentLimit = Math.max(1000, Math.floor(currentLimit / 2));
          await esperarMs(250 * (attempt + 1), signal);
          continue;
        }
        throw res.error;
      }
      return { rows: [], usedLimit: currentLimit };
    };

    // Si todo cabe en una sola llamada RPC (<= safeRpcLimit), descargar en 1 petición
    if (total !== null && total <= safeRpcLimit) {
      const probe = await runRpcWithRetry({
        minId: null,
        maxId: null,
        afterId: null,
        limit: safeRpcLimit,
      });
      if (!probe.rpcMissing) {
        let rows = probe.rows;
        if (rows.length >= probe.usedLimit && rows.length > 0) {
          // Si el límite adaptativo se redujo, completar el resto secuencialmente con cursor
          let cursor = rows[rows.length - 1].id;
          while (true) {
            const next = await runRpcWithRetry({
              minId: null,
              maxId: null,
              afterId: cursor,
              limit: probe.usedLimit,
            });
            if (!next.rows || next.rows.length === 0) break;
            for (let i = 0; i < next.rows.length; i++) rows.push(next.rows[i]);
            if (onProgress) onProgress(Math.min(rows.length, Math.max(total, rows.length)), Math.max(total, rows.length));
            if (next.rows.length < next.usedLimit) break;
            cursor = next.rows[next.rows.length - 1].id;
          }
        }
        if (onProgress) onProgress(rows.length, Math.max(total, rows.length));
        return rows;
      }
    } else {
      // Sondear el primer bucket para confirmar que la RPC existe antes de abrir los streams paralelos
      const buckets = concurrency >= 4 ? UUID_BUCKETS_4 : UUID_BUCKETS_2;
      const firstBucket = buckets[0];
      const probe = await runRpcWithRetry({
        minId: firstBucket.minId,
        maxId: firstBucket.maxId,
        afterId: null,
        limit: safeRpcLimit,
      });

      if (!probe.rpcMissing) {
        let loaded = probe.rows.length;
        const estimatedTotal = total !== null ? Math.max(total, loaded) : loaded;
        if (onProgress) onProgress(loaded, estimatedTotal);

        const drainBucket = async (bucket, initialRows = null, initialUsedLimit = safeRpcLimit) => {
          const collected = initialRows ? [...initialRows] : [];
          let afterId = null;
          let stepLimit = initialUsedLimit;

          if (initialRows !== null) {
            if (initialRows.length < initialUsedLimit || initialRows.length === 0) {
              return collected;
            }
            afterId = initialRows[initialRows.length - 1].id;
          }

          while (true) {
            const batch = await runRpcWithRetry({
              minId: bucket.minId,
              maxId: bucket.maxId,
              afterId,
              limit: stepLimit,
            });
            if (!batch.rows || batch.rows.length === 0) break;
            for (let i = 0; i < batch.rows.length; i++) {
              collected.push(batch.rows[i]);
            }
            loaded += batch.rows.length;
            if (onProgress) {
              const denom = total !== null ? Math.max(total, loaded) : loaded;
              onProgress(Math.min(loaded, denom), denom);
            }
            stepLimit = batch.usedLimit;
            if (batch.rows.length < batch.usedLimit) break;
            afterId = batch.rows[batch.rows.length - 1].id;
          }

          return collected;
        };

        const bucketArrays = await Promise.all(
          buckets.map((bucket, idx) =>
            idx === 0
              ? drainBucket(bucket, probe.rows, probe.usedLimit)
              : drainBucket(bucket, null, safeRpcLimit)
          )
        );

        const all = [];
        for (const arr of bucketArrays) {
          for (let i = 0; i < arr.length; i++) {
            all.push(arr[i]);
          }
        }
        if (onProgress) onProgress(all.length, all.length);
        return all;
      }
    }
  }

  // 3. Fallback sin migración para lotes pequeños/medianos (<= 8,000 filas): paralelo rápido
  if (typeof fetchOffsetPage === 'function' && total !== null && total <= 8000) {
    return fetchAllSupabasePages({
      fetchPage: fetchOffsetPage,
      pageSize: safePageSize,
      concurrency: Math.max(2, concurrency),
      label,
      onProgress,
      signal,
    });
  }

  // 4. Fallback sin migración para lotes grandes (> 8,000 filas): Keyset sobre `car_sunat` (0 OFFSET)
  if (typeof fetchCarKeysetPage === 'function') {
    const all = [];
    let lastCar = null;
    let currentLimit = safePageSize;

    while (true) {
      throwIfAborted(signal);
      let rows = null;
      let usedLimit = currentLimit;

      for (let attempt = 0; attempt <= 2; attempt++) {
        const res = await fetchCarKeysetPage(lastCar, usedLimit);
        throwIfAborted(signal);
        if (!res.error) {
          rows = res.data || [];
          break;
        }
        if (esErrorLecturaReintentable(res.error) && attempt < 2) {
          usedLimit = Math.max(250, Math.floor(usedLimit / 2));
          await esperarMs(250 * (attempt + 1), signal);
          continue;
        }
        throw res.error;
      }

      if (!rows || rows.length === 0) break;
      for (let i = 0; i < rows.length; i++) {
        all.push(rows[i]);
      }
      if (onProgress) {
        const denom = total !== null ? Math.max(total, all.length) : all.length;
        onProgress(Math.min(all.length, denom), denom);
      }

      const lastRow = rows[rows.length - 1];
      if (!lastRow || lastRow.car_sunat === null || lastRow.car_sunat === undefined) break;
      if (lastRow.car_sunat === lastCar) break;
      lastCar = lastRow.car_sunat;

      if (rows.length < usedLimit) break;
      currentLimit = usedLimit;
    }

    // Incluir eventuales registros legacy con car_sunat IS NULL
    if (typeof fetchNullCarPage === 'function' && (total === null || all.length < total)) {
      throwIfAborted(signal);
      const nullRes = await fetchNullCarPage();
      throwIfAborted(signal);
      if (!nullRes?.error && Array.isArray(nullRes?.data) && nullRes.data.length > 0) {
        const seen = new Set(all.map((r) => r.id));
        for (const r of nullRes.data) {
          if (!seen.has(r.id)) {
            all.push(r);
          }
        }
      }
    }

    if (onProgress) onProgress(all.length, all.length);
    return all;
  }

  // Último fallback: paginación estándar por rangos
  return fetchAllSupabasePages({
    fetchPage: fetchOffsetPage,
    pageSize: safePageSize,
    concurrency: Math.max(2, concurrency),
    label,
    onProgress,
    signal,
  });
}
