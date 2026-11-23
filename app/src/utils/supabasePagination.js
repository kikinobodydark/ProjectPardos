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
 * Extrae `buckets - 1` claves de corte `car_sunat` balanceadas a partir de un conjunto
 * ya descargado o conciliado, para persistirlas en `resumen_json._carSplits` y permitir
 * lecturas paralelas en 0 ms de planificación en futuras aperturas del período.
 */
export function computeCarSplitsFromKeys(carKeys, buckets = 4) {
  if (!Array.isArray(carKeys) || carKeys.length < buckets * 2) return [];
  const valid = [];
  for (let i = 0; i < carKeys.length; i++) {
    const k = carKeys[i];
    if (typeof k === 'string' && k.length > 0) valid.push(k);
  }
  if (valid.length < buckets * 2) return [];
  valid.sort();
  const splits = [];
  const step = Math.floor(valid.length / buckets);
  for (let i = 1; i < buckets; i++) {
    const candidate = valid[step * i];
    if (candidate && (splits.length === 0 || candidate > splits[splits.length - 1])) {
      splits.push(candidate);
    }
  }
  return splits;
}

function normalizeCarSplits(rawSplits) {
  if (!Array.isArray(rawSplits) || rawSplits.length === 0) return [];
  const out = [];
  for (const s of rawSplits) {
    if (typeof s === 'string' && s.length > 0 && (out.length === 0 || s > out[out.length - 1])) {
      out.push(s);
    }
  }
  return out;
}

function getRowId(row) {
  return Array.isArray(row) ? row[0] : row?.id;
}

function getRowCar(row) {
  return Array.isArray(row) ? row[1] : row?.car_sunat;
}

/**
 * Descarga todas las filas de un período evitando el escaneo cuadrático O(N²) de OFFSET:
 * 1. Vía ultra-rápida: RPC Keyset compacta (tuplas JSON) sobre `car_sunat` en buckets
 *    paralelos (4.7x menos páginas heap, 65% menos JSON, streaming por lote vía `onBatch`).
 * 2. Vía rápida legacy: RPC Keyset JSON en 4 (o 2) buckets UUID paralelos.
 * 3. Fallback automático (si las RPCs aún no se han migrado en Supabase):
 *    - Lotes pequeños (<= 8,000 filas): paginación paralela de 1,000 filas.
 *    - Lotes grandes (> 8,000 filas): paginación Keyset O(log N) sobre `car_sunat` + filas NULL.
 */
export async function fetchAllSupabaseKeyset({
  knownTotal = null,
  fetchCount,
  cachedCarSplits = null,
  fetchCarSplits,
  fetchCompactBatch,
  fetchRpcBatch,
  fetchCarKeysetPage,
  fetchNullCarPage,
  fetchOffsetPage,
  pageSize = SUPABASE_MAX_SELECT_ROWS,
  rpcLimit = SUPABASE_KEYSET_RPC_LIMIT,
  compactRpcLimit = SUPABASE_KEYSET_RPC_LIMIT,
  concurrency = 4,
  compactConcurrency = 4,
  label = 'SupabaseKeyset',
  onProgress,
  onBatch,
  signal,
}) {
  throwIfAborted(signal);

  const safePageSize = Math.max(100, Math.min(pageSize || SUPABASE_MAX_SELECT_ROWS, SUPABASE_MAX_SELECT_ROWS));
  const safeRpcLimit = Math.max(500, Math.min(rpcLimit || SUPABASE_KEYSET_RPC_LIMIT, SUPABASE_KEYSET_RPC_LIMIT));
  const safeCompactLimit = Math.max(500, Math.min(compactRpcLimit || SUPABASE_KEYSET_RPC_LIMIT, SUPABASE_KEYSET_RPC_LIMIT));

  // 1. Obtener conteo total exacto rápidamente (O(1) desde memoria o periodos_carga)
  let total = typeof knownTotal === 'number' && Number.isFinite(knownTotal) ? knownTotal : null;
  if (total === 0) {
    if (onProgress) onProgress(0, 0);
    return [];
  }
  if (total !== null) {
    if (onProgress) onProgress(0, total);
  } else if (typeof fetchCount === 'function') {
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

  // 2A. Vía ultra-rápida: RPC compacta sobre `car_sunat` (orden físico + tuplas sin nombres repetidos)
  if (typeof fetchCompactBatch === 'function') {
    const runCompactWithRetry = async ({ minCar, maxCar, afterCar, limit }) => {
      let currentLimit = limit;
      for (let attempt = 0; attempt <= 2; attempt++) {
        throwIfAborted(signal);
        const res = await fetchCompactBatch({ minCar, maxCar, afterCar, limit: currentLimit });
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

    // Lote pequeño (cabe en 1 sola llamada compacta)
    if (total !== null && total <= safeCompactLimit) {
      const probe = await runCompactWithRetry({
        minCar: null,
        maxCar: null,
        afterCar: null,
        limit: safeCompactLimit,
      });
      if (!probe.rpcMissing) {
        const rows = [...probe.rows];
        if (rows.length > 0 && onBatch) {
          onBatch(rows, rows.length, Math.max(total, rows.length));
        }
        if (rows.length >= probe.usedLimit && rows.length > 0) {
          let cursor = getRowCar(rows[rows.length - 1]);
          while (cursor) {
            const next = await runCompactWithRetry({
              minCar: null,
              maxCar: null,
              afterCar: cursor,
              limit: probe.usedLimit,
            });
            if (!next.rows || next.rows.length === 0) break;
            for (let i = 0; i < next.rows.length; i++) rows.push(next.rows[i]);
            const denom = Math.max(total, rows.length);
            if (onProgress) onProgress(Math.min(rows.length, denom), denom);
            if (onBatch) onBatch(next.rows, Math.min(rows.length, denom), denom);
            if (next.rows.length < next.usedLimit) break;
            const nextCursor = getRowCar(next.rows[next.rows.length - 1]);
            if (!nextCursor || nextCursor === cursor) break;
            cursor = nextCursor;
          }
        }
        if (typeof fetchNullCarPage === 'function' && rows.length < total) {
          const nullRes = await fetchNullCarPage();
          throwIfAborted(signal);
          if (!nullRes?.error && Array.isArray(nullRes?.data) && nullRes.data.length > 0) {
            const seen = new Set(rows.map(getRowId));
            const extra = [];
            for (const r of nullRes.data) {
              if (!seen.has(getRowId(r))) {
                rows.push(r);
                extra.push(r);
              }
            }
            if (extra.length > 0 && onBatch) onBatch(extra, rows.length, Math.max(total, rows.length));
          }
        }
        if (onProgress) onProgress(rows.length, Math.max(total, rows.length));
        return rows;
      }
    } else {
      // Lote grande (> 5,000 filas): obtener particiones `car_sunat` balanceadas (0 ms si vienen cacheadas)
      let splits = normalizeCarSplits(cachedCarSplits);
      let compactMissing = false;

      if (splits.length === 0 && compactConcurrency >= 2 && typeof fetchCarSplits === 'function') {
        try {
          const splitRes = await fetchCarSplits(compactConcurrency);
          throwIfAborted(signal);
          if (!splitRes?.error) {
            splits = normalizeCarSplits(splitRes?.data);
          } else if (esRpcFaltanteError(splitRes.error)) {
            compactMissing = true;
          }
        } catch (err) {
          if (err?.name === 'AbortError') throw err;
          if (esRpcFaltanteError(err)) {
            compactMissing = true;
          }
        }
      }

      if (!compactMissing) {
        const carBuckets = [];
        if (splits.length > 0) {
          carBuckets.push({ minCar: null, maxCar: splits[0] });
          for (let i = 0; i < splits.length - 1; i++) {
            carBuckets.push({ minCar: splits[i], maxCar: splits[i + 1] });
          }
          carBuckets.push({ minCar: splits[splits.length - 1], maxCar: null });
        } else {
          carBuckets.push({ minCar: null, maxCar: null });
        }

        let loaded = 0;
        let rpcMissingDetected = false;

        const drainCarBucket = async (bucket) => {
          const collected = [];
          let afterCar = null;
          let stepLimit = safeCompactLimit;

          while (true) {
            const batch = await runCompactWithRetry({
              minCar: bucket.minCar,
              maxCar: bucket.maxCar,
              afterCar,
              limit: stepLimit,
            });
            if (batch.rpcMissing) {
              rpcMissingDetected = true;
              return null;
            }
            if (!batch.rows || batch.rows.length === 0) break;
            for (let i = 0; i < batch.rows.length; i++) {
              collected.push(batch.rows[i]);
            }
            loaded += batch.rows.length;
            const denom = total !== null ? Math.max(total, loaded) : loaded;
            const clamped = Math.min(loaded, denom);
            if (onProgress) onProgress(clamped, denom);
            if (onBatch) onBatch(batch.rows, clamped, denom);

            stepLimit = batch.usedLimit;
            if (batch.rows.length < batch.usedLimit) break;
            const nextCar = getRowCar(batch.rows[batch.rows.length - 1]);
            if (!nextCar || nextCar === afterCar) break;
            afterCar = nextCar;
          }
          return collected;
        };

        const bucketArrays = await Promise.all(carBuckets.map((b) => drainCarBucket(b)));

        if (!rpcMissingDetected) {
          const all = [];
          for (const arr of bucketArrays) {
            if (!arr) continue;
            for (let i = 0; i < arr.length; i++) {
              all.push(arr[i]);
            }
          }

          if (typeof fetchNullCarPage === 'function' && (total === null || all.length < total)) {
            throwIfAborted(signal);
            const nullRes = await fetchNullCarPage();
            throwIfAborted(signal);
            if (!nullRes?.error && Array.isArray(nullRes?.data) && nullRes.data.length > 0) {
              const seen = new Set(all.map(getRowId));
              const extra = [];
              for (const r of nullRes.data) {
                if (!seen.has(getRowId(r))) {
                  all.push(r);
                  extra.push(r);
                }
              }
              if (extra.length > 0 && onBatch) onBatch(extra, all.length, all.length);
            }
          }

          if (onProgress) onProgress(all.length, all.length);
          return all;
        }
      }
    }
  }

  // 2B. Vía rápida legacy: RPC Keyset JSON sobre buckets UUID (hasta 5,000 filas/petición, 0 OFFSET)
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
        if (rows.length > 0 && onBatch) onBatch(rows, rows.length, Math.max(total, rows.length));
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
            const denom = Math.max(total, rows.length);
            if (onProgress) onProgress(Math.min(rows.length, denom), denom);
            if (onBatch) onBatch(next.rows, Math.min(rows.length, denom), denom);
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
        if (probe.rows.length > 0 && onBatch) onBatch(probe.rows, loaded, estimatedTotal);

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
            const denom = total !== null ? Math.max(total, loaded) : loaded;
            const clamped = Math.min(loaded, denom);
            if (onProgress) onProgress(clamped, denom);
            if (onBatch) onBatch(batch.rows, clamped, denom);
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
