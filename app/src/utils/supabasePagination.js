// ============================================================================
// Paginación robusta para consultas Supabase / PostgREST sin truncamiento por
// el límite por defecto de filas (`max_rows = 1000`).
// - Nunca asume que el servidor devolverá más filas de las que realmente retornó
//   en la primera página (`step = firstPage.length`), evitando saltos o cortes
//   prematuros cuando el perfil de red sugiere lotes > 1000 o cuando PostgREST
//   limita la respuesta.
// - Descarga las páginas restantes en paralelo controlado (`executeParallelBatches`)
//   preservando exactamente el orden de las páginas.
// ============================================================================
import { executeParallelBatches } from './jobQueue.js';

export const SUPABASE_MAX_SELECT_ROWS = 1000;

/**
 * Descarga todas las filas de una consulta Supabase paginada por rangos.
 *
 * @param {object} options
 * @param {(from: number, to: number, withCount: boolean) => Promise<{ data: any[], count?: number|null, error: any }>} options.fetchPage
 *   Ejecuta la consulta para el rango inclusivo [from, to]. Cuando `withCount` es true
 *   (primera página), debe solicitar `{ count: 'exact' }`.
 * @param {number} [options.pageSize=1000] Tamaño preferido de página (acotado a 1000).
 * @param {number} [options.concurrency=4] Concurrencia máxima para páginas paralelas.
 * @param {string} [options.label='SupabasePage'] Etiqueta para telemetría.
 * @param {(loaded: number, total: number) => void} [options.onProgress] Callback opcional de progreso.
 * @returns {Promise<any[]>}
 */
export async function fetchAllSupabasePages({
  fetchPage,
  pageSize = SUPABASE_MAX_SELECT_ROWS,
  concurrency = 4,
  label = 'SupabasePage',
  onProgress,
}) {
  const requestedPageSize = Math.max(
    1,
    Math.min(pageSize || SUPABASE_MAX_SELECT_ROWS, SUPABASE_MAX_SELECT_ROWS)
  );

  // 1. Primera página con conteo exacto
  const { data: firstPage, count, error } = await fetchPage(0, requestedPageSize - 1, true);
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

  // Usar el tamaño real devuelto por el servidor como paso de paginación.
  // Así, si PostgREST aplica `max_rows` (1000, 500, etc.), nunca se saltan filas
  // ni se detiene la descarga antes de completar el total.
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
        const to = Math.min(from + step - 1, total - 1);
        const res = await fetchPage(from, to, false);
        if (res.error) throw res.error;
        const rows = res.data || [];
        loaded += rows.length;
        if (onProgress) onProgress(Math.min(loaded, total), total);
        return rows;
      },
      { concurrency, label }
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
      const res = await fetchPage(from, from + step - 1, false);
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
