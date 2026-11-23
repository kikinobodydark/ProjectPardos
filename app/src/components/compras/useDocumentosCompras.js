// ============================================================================
// Hook de acceso a los documentos conciliados del módulo de Compras (RCE).
// - Descarga Keyset O(log N) sin OFFSET O(N²): usa RPC JSONB en buckets UUID
//   paralelos (hasta 5,000 filas/petición) con fallback automático sobre índice
//   único `car_sunat` si la migración aún no se aplicó.
// - Propaga `AbortSignal` de React Query para cancelar descargas al cambiar de
//   período, empresa o pestaña.
// - Hidrata y ordena documentos fuera del hilo principal (Web Worker) y reporta
//   progreso en tiempo real (`loadProgress`).
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
import {
  fetchAllSupabaseKeyset,
  SUPABASE_MAX_SELECT_ROWS,
  SUPABASE_KEYSET_RPC_LIMIT,
} from '../../utils/supabasePagination';

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

export function useDocumentosCompras(periodId, enabled = true) {
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
    queryKey: ['comprasDocumentos', periodId],
    queryFn: async ({ signal }) => {
      if (!periodId) return [];

      const cacheKeyHash = JSON.stringify(['comprasDocumentos', periodId]);
      const cachedEntry = await idbGetQueryEntry(cacheKeyHash);
      if (Array.isArray(cachedEntry?.data) && cachedEntry.data.length > 0) {
        emitProgress(periodId, null);
        return cachedEntry.data;
      }

      const net = getNetworkProfile();
      const pageSize = Math.min(
        net.recommendedReadPageSize || SUPABASE_MAX_SELECT_ROWS,
        SUPABASE_MAX_SELECT_ROWS
      );
      const rpcLimit = Math.min(
        net.recommendedReadRpcLimit || SUPABASE_KEYSET_RPC_LIMIT,
        SUPABASE_KEYSET_RPC_LIMIT
      );
      const concurrency = net.recommendedReadConcurrency || 4;

      emitProgress(periodId, { loaded: 0, total: 0, phase: 'downloading' });

      try {
        const all = await fetchAllSupabaseKeyset({
          pageSize,
          rpcLimit,
          concurrency,
          signal,
          label: 'ComprasDocumentosKeyset',
          onProgress: (loaded, total) => {
            emitProgress(periodId, { loaded, total, phase: 'downloading' });
          },
          fetchCount: () =>
            supabase
              .from('detalle_compras')
              .select('id', { count: 'exact', head: true })
              .eq('periodo_id', periodId)
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

        if (signal?.aborted) {
          throw new DOMException('Operación cancelada.', 'AbortError');
        }
        if (all.length === 0) {
          emitProgress(periodId, null);
          return [];
        }

        emitProgress(periodId, { loaded: all.length, total: all.length, phase: 'processing' });
        const docs = await runCpuTaskInWorker('HYDRATE_COMPRAS_DOCS', { filas: all });
        idbSetQuery(cacheKeyHash, ['comprasDocumentos', periodId], docs, IDB_DOCS_CACHE_VERSION);
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
