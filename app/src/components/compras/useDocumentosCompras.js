// ============================================================================
// Hook y Precargador de documentos conciliados del módulo de Compras (RCE).
// - Descarga ultra-rápida en tuplas JSON por buckets `car_sunat` paralelos
//   (fallback automático a UUID JSON / keyset).
// - Descarga persistente en segundo plano (`documentSyncManager`): NO se aborta
//   al navegar entre Dashboard y Conciliación; solo al cambiar período/empresa/sesión.
// - Streaming progresivo (`partialDocs`): muestra resultados reales en Conciliación
//   conforme llegan los lotes sin bloquear al usuario.
// ============================================================================
import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../utils/supabaseClient';
import { getNetworkProfile } from '../../utils/networkProfile';
import {
  idbGetQueryEntry,
  idbSetQuery,
  IDB_DOCS_CACHE_VERSION,
} from '../../utils/queryPersister';
import { runCpuTaskInWorker } from '../../utils/jobQueue';
import { calcularIndicadoresCompras } from '../../utils/compras/reportes';
import {
  fetchAllSupabaseKeyset,
  computeCarSplitsFromKeys,
  SUPABASE_MAX_SELECT_ROWS,
  SUPABASE_KEYSET_RPC_LIMIT,
} from '../../utils/supabasePagination';
import {
  runOrJoinPeriodSync,
  getSyncProgress,
  getPartialDocs,
  subscribeSyncProgress,
  subscribePartialDocs,
} from '../../utils/documentSyncManager';

export const COLUMNAS_DETALLE_COMPRAS = [
  'id',
  'car_sunat',
  'ruc_proveedor',
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
  'estado_validacion',
  'errores_json',
].join(',');

export function crearQueryFnCompras(periodId, { periodObj = null, queryClient = null } = {}) {
  return async () => {
    if (!periodId) return [];

    return runOrJoinPeriodSync({
      modulo: 'compras',
      periodId,
      batchWorkerAction: 'HYDRATE_COMPRAS_BATCH',
      executor: async ({ signal, emitProgress, pushRawBatch }) => {
        const cacheKeyHash = JSON.stringify(['comprasDocumentos', periodId]);
        const cachedEntry = await idbGetQueryEntry(cacheKeyHash);
        if (signal.aborted) {
          throw new DOMException('Operación cancelada.', 'AbortError');
        }
        if (Array.isArray(cachedEntry?.data) && cachedEntry.data.length > 0) {
          emitProgress(null);
          return cachedEntry.data;
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
        const compactRpcLimit = Math.min(
          net.recommendedCompactRpcLimit || SUPABASE_KEYSET_RPC_LIMIT,
          SUPABASE_KEYSET_RPC_LIMIT
        );
        const concurrency = net.recommendedReadConcurrency || 2;
        const compactConcurrency = net.recommendedCompactReadConcurrency || 4;
        const knownTotal =
          typeof periodObj?.total_registros === 'number' && Number.isFinite(periodObj.total_registros)
            ? periodObj.total_registros
            : null;
        const cachedCarSplits = Array.isArray(periodObj?.resumen_json?._carSplits)
          ? periodObj.resumen_json._carSplits
          : null;

        emitProgress({ loaded: 0, total: knownTotal || 0, phase: 'downloading' });

        const all = await fetchAllSupabaseKeyset({
          knownTotal,
          cachedCarSplits,
          pageSize,
          rpcLimit,
          compactRpcLimit,
          concurrency,
          compactConcurrency,
          signal,
          label: 'ComprasDocumentosKeyset',
          onProgress: (loaded, total) => {
            emitProgress({ loaded, total, phase: 'downloading' });
          },
          onBatch: (rows) => {
            pushRawBatch(rows);
          },
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
          fetchCarSplits: (buckets) =>
            supabase
              .rpc('obtener_particiones_periodo', {
                p_periodo_id: periodId,
                p_modulo: 'compras',
                p_buckets: buckets,
              })
              .abortSignal(signal),
          fetchCompactBatch: ({ minCar, maxCar, afterCar, limit }) =>
            supabase
              .rpc('obtener_lote_compras_compact', {
                p_periodo_id: periodId,
                p_min_car: minCar,
                p_max_car: maxCar,
                p_after_car: afterCar,
                p_limit: limit,
              })
              .abortSignal(signal),
          fetchRpcBatch: ({ minId, maxId, afterId, limit }) =>
            supabase
              .rpc('obtener_lote_compras_json', {
                p_periodo_id: periodId,
                p_min_id: minId,
                p_max_id: maxId,
                p_after_id: afterId,
                p_limit: limit,
              })
              .abortSignal(signal),
          fetchOffsetPage: (from, to, withCount) =>
            supabase
              .from('detalle_compras')
              .select(COLUMNAS_DETALLE_COMPRAS, withCount ? { count: 'exact' } : undefined)
              .eq('periodo_id', periodId)
              .order('car_sunat', { ascending: true })
              .range(from, to)
              .abortSignal(signal),
          fetchCarKeysetPage: (lastCar, limit) => {
            let q = supabase
              .from('detalle_compras')
              .select(COLUMNAS_DETALLE_COMPRAS)
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
              .from('detalle_compras')
              .select(COLUMNAS_DETALLE_COMPRAS)
              .eq('periodo_id', periodId)
              .is('car_sunat', null)
              .order('id', { ascending: true })
              .limit(1000)
              .abortSignal(signal),
        });

        if (signal.aborted) {
          throw new DOMException('Operación cancelada.', 'AbortError');
        }
        if (all.length === 0) {
          emitProgress(null);
          return [];
        }

        const carKeys = all.map((r) => (Array.isArray(r) ? r[1] : r?.car_sunat));
        const carSplits = computeCarSplitsFromKeys(carKeys, 4);

        emitProgress({ loaded: all.length, total: all.length, phase: 'processing' });
        const docs = await runCpuTaskInWorker('HYDRATE_COMPRAS_DOCS', { filas: all });
        if (signal.aborted) {
          throw new DOMException('Operación cancelada.', 'AbortError');
        }

        setTimeout(() => {
          idbSetQuery(cacheKeyHash, ['comprasDocumentos', periodId], docs, IDB_DOCS_CACHE_VERSION);
          try {
            const resumen = calcularIndicadoresCompras(docs);
            if (carSplits.length > 0) {
              resumen._carSplits = carSplits;
            }
            const needsResumenSave =
              !periodObj?.resumen_json ||
              (carSplits.length > 0 && !Array.isArray(periodObj?.resumen_json?._carSplits));
            if (needsResumenSave) {
              supabase.rpc('guardar_resumen_periodo', {
                p_periodo_id: periodId,
                p_resumen: resumen,
              }).then(({ error }) => {
                if (!error && queryClient) {
                  queryClient.setQueriesData({ queryKey: ['periods'] }, (old) =>
                    Array.isArray(old)
                      ? old.map((p) => (p.id === periodId ? { ...p, resumen_json: resumen } : p))
                      : old
                  );
                }
              }).catch(() => {});
            }
          } catch {
            // Ignorar errores opcionales de caché de resumen
          }
        }, 50);

        emitProgress(null);
        return docs;
      },
    });
  };
}

export function prefetchDocumentosCompras(queryClient, periodId, periodObj = null) {
  if (!queryClient || !periodId) return Promise.resolve();
  const existing = queryClient.getQueryData(['comprasDocumentos', periodId]);
  if (Array.isArray(existing) && existing.length > 0) {
    return Promise.resolve(existing);
  }
  return queryClient.prefetchQuery({
    queryKey: ['comprasDocumentos', periodId],
    queryFn: crearQueryFnCompras(periodId, { periodObj, queryClient }),
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}

export function useDocumentosCompras(periodId, enabled = true, { periodObj = null, streamPartial = false } = {}) {
  const queryClient = useQueryClient();
  const [loadProgress, setLoadProgress] = useState(() =>
    periodId ? getSyncProgress('compras', periodId) : null
  );
  const [partialDocs, setPartialDocs] = useState(() =>
    streamPartial && periodId ? getPartialDocs('compras', periodId) : []
  );

  useEffect(() => {
    if (!periodId) {
      setLoadProgress(null);
      return undefined;
    }
    setLoadProgress(getSyncProgress('compras', periodId));
    return subscribeSyncProgress('compras', periodId, setLoadProgress);
  }, [periodId]);

  useEffect(() => {
    if (!streamPartial || !periodId) {
      setPartialDocs([]);
      return undefined;
    }
    setPartialDocs(getPartialDocs('compras', periodId));
    return subscribePartialDocs('compras', periodId, setPartialDocs);
  }, [periodId, streamPartial]);

  const query = useQuery({
    queryKey: ['comprasDocumentos', periodId],
    queryFn: crearQueryFnCompras(periodId, { periodObj, queryClient }),
    enabled: !!periodId && enabled,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 0,
  });

  const hasFinalData = Array.isArray(query.data) && query.data.length > 0;

  return {
    ...query,
    loadProgress,
    partialDocs: hasFinalData ? [] : partialDocs,
    isStreaming: !hasFinalData && (query.isLoading || !!loadProgress) && partialDocs.length > 0,
  };
}
