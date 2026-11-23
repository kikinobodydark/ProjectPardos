// ============================================================================
// Hook de acceso a los documentos conciliados del módulo de Ventas.
// - Descarga Keyset O(log N) sin OFFSET O(N²): usa RPC JSONB en buckets UUID
//   paralelos (hasta 5,000 filas/petición) con fallback automático sobre índice
//   único `car_sunat` si la migración aún no se aplicó.
// - Propaga `AbortSignal` de React Query para cancelar descargas al cambiar de
//   período, empresa o pestaña (evita saturar el pool de conexiones y Postgres).
// - Hidrata y enriquece secuencias fuera del hilo principal (Web Worker) y
//   reporta progreso en tiempo real (`loadProgress`).
// ============================================================================
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../utils/supabaseClient';
import { getNetworkProfile } from '../../utils/networkProfile';
import {
  idbGetQueryEntry,
  idbSetQuery,
  IDB_DOCS_CACHE_VERSION,
} from '../../utils/queryPersister';
import { runCpuTaskInWorker } from '../../utils/jobQueue';
import { enriquecerSecuenciasEnDocs } from '../../utils/ventas/reglas';
import { calcularIndicadores } from '../../utils/ventas/reportes';
import {
  fetchAllSupabaseKeyset,
  SUPABASE_MAX_SELECT_ROWS,
  SUPABASE_KEYSET_RPC_LIMIT,
} from '../../utils/supabasePagination';

export const COLUMNAS_DETALLE_VENTAS = [
  'id',
  'car_sunat',
  'serie',
  'correlativo',
  'fecha_emision',
  'tipo_doc_pago',
  'tipo_identidad_sap',
  'nro_identidad_sap',
  'nombre_sap',
  'base_sap',
  'igv_sap',
  'exonerado_sap',
  'inafecto_sap',
  'otros_sap',
  'total_sap',
  'tipo_identidad_sunat',
  'nro_identidad_sunat',
  'nombre_sunat',
  'base_sunat',
  'igv_sunat',
  'exonerado_sunat',
  'inafecto_sunat',
  'otros_sunat',
  'total_sunat',
  'tipo_pago_sire',
  'op_gratuitas',
  'estado_validacion',
  'errores_json',
].join(',');

// Estado compartido de progreso por periodId para sincronizar Dashboard y Conciliación
const progressByPeriod = new Map();
const progressListeners = new Set();

function emitProgress(periodId, state) {
  if (!periodId) return;
  if (state) {
    progressByPeriod.set(periodId, state);
  } else {
    progressByPeriod.delete(periodId);
  }
  progressListeners.forEach((fn) => {
    try {
      fn(periodId, state);
    } catch {
      // ignore listener errors
    }
  });
}

export function useDocumentosVentas(periodId, enabled = true) {
  const [loadProgress, setLoadProgress] = useState(() =>
    periodId ? progressByPeriod.get(periodId) || null : null
  );

  useEffect(() => {
    setLoadProgress(periodId ? progressByPeriod.get(periodId) || null : null);
    const listener = (pid, state) => {
      if (pid === periodId) {
        setLoadProgress(state);
      }
    };
    progressListeners.add(listener);
    return () => {
      progressListeners.delete(listener);
    };
  }, [periodId]);

  const query = useQuery({
    queryKey: ['ventasDocumentos', periodId],
    queryFn: async ({ signal }) => {
      if (!periodId) return [];

      // 0. Verificar primero en caché persistente IndexedDB (restauración en ~20ms tras F5)
      const cacheKeyHash = JSON.stringify(['ventasDocumentos', periodId]);
      const cachedEntry = await idbGetQueryEntry(cacheKeyHash);
      if (Array.isArray(cachedEntry?.data) && cachedEntry.data.length > 0) {
        if (cachedEntry.cacheVersion === IDB_DOCS_CACHE_VERSION) {
          emitProgress(periodId, null);
          return cachedEntry.data;
        }
        const enriched = enriquecerSecuenciasEnDocs(cachedEntry.data);
        idbSetQuery(cacheKeyHash, ['ventasDocumentos', periodId], enriched, IDB_DOCS_CACHE_VERSION);
        emitProgress(periodId, null);
        return enriched;
      }

      const net = getNetworkProfile();
      const pageSize = Math.min(
        net.recommendedReadPageSize || SUPABASE_MAX_SELECT_ROWS,
        SUPABASE_MAX_SELECT_ROWS
      );
      const rpcLimit = Math.min(
        net.recommendedReadRpcLimit || 2500,
        SUPABASE_KEYSET_RPC_LIMIT
      );
      const concurrency = net.recommendedReadConcurrency || 2;

      emitProgress(periodId, { loaded: 0, total: 0, phase: 'downloading' });

      try {
        const all = await fetchAllSupabaseKeyset({
          pageSize,
          rpcLimit,
          concurrency,
          signal,
          label: 'VentasDocumentosKeyset',
          onProgress: (loaded, total) => {
            emitProgress(periodId, { loaded, total, phase: 'downloading' });
          },
          // Leer total_registros precalculado en periodos_carga (O(1), 0.5ms) en lugar de HEAD count(*) sobre 120k+ filas
          fetchCount: async () => {
            const { data, error } = await supabase
              .from('periodos_carga')
              .select('total_registros')
              .eq('id', periodId)
              .maybeSingle()
              .abortSignal(signal);
            if (!error && typeof data?.total_registros === 'number') {
              return { count: data.total_registros, error: null };
            }
            return { count: null, error: null };
          },
          fetchRpcBatch: ({ minId, maxId, afterId, limit }) =>
            supabase
              .rpc('obtener_lote_ventas_json', {
                p_periodo_id: periodId,
                p_min_id: minId,
                p_max_id: maxId,
                p_after_id: afterId,
                p_limit: limit,
              })
              .abortSignal(signal),
          fetchOffsetPage: (from, to, withCount) =>
            supabase
              .from('detalle_ventas')
              .select(COLUMNAS_DETALLE_VENTAS, withCount ? { count: 'exact' } : undefined)
              .eq('periodo_id', periodId)
              .order('car_sunat', { ascending: true })
              .range(from, to)
              .abortSignal(signal),
          fetchCarKeysetPage: (lastCar, limit) => {
            let q = supabase
              .from('detalle_ventas')
              .select(COLUMNAS_DETALLE_VENTAS)
              .eq('periodo_id', periodId)
              .not('car_sunat', 'is', null)
              .order('car_sunat', { ascending: true })
              .limit(limit);
            if (lastCar !== null) {
              q = q.gt('car_sunat', lastCar);
            }
            return q.abortSignal(signal);
          },
          fetchNullCarPage: () =>
            supabase
              .from('detalle_ventas')
              .select(COLUMNAS_DETALLE_VENTAS)
              .eq('periodo_id', periodId)
              .is('car_sunat', null)
              .order('id', { ascending: true })
              .limit(1000)
              .abortSignal(signal),
        });

        if (signal?.aborted) {
          throw new DOMException('Operación cancelada.', 'AbortError');
        }
        if (all.length === 0) {
          emitProgress(periodId, null);
          return [];
        }

        emitProgress(periodId, { loaded: all.length, total: all.length, phase: 'processing' });
        const docs = await runCpuTaskInWorker('HYDRATE_VENTAS_DOCS', { filas: all });
        // Persistir en IndexedDB sin bloquear el frame de pintado y cachear resumen en periodos_carga para Dashboard <50ms
        setTimeout(() => {
          idbSetQuery(cacheKeyHash, ['ventasDocumentos', periodId], docs, IDB_DOCS_CACHE_VERSION);
          try {
            const resumen = calcularIndicadores(docs);
            supabase.rpc('guardar_resumen_periodo', {
              p_periodo_id: periodId,
              p_resumen: resumen,
            }).then(() => {}).catch(() => {});
          } catch {
            // Ignorar errores opcionales de caché de resumen
          }
        }, 50);
        emitProgress(periodId, null);
        return docs;
      } catch (err) {
        emitProgress(periodId, null);
        throw err;
      }
    },
    enabled: !!periodId && enabled,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 0,
  });

  return {
    ...query,
    loadProgress,
  };
}
