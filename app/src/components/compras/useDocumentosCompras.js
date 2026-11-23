// ============================================================================
// Hook de acceso a los documentos conciliados del módulo de Compras (RCE).
// - Pide únicamente las columnas necesarias de public.detalle_compras.
// - Usa caché persistente IndexedDB + paginación paralela de Supabase.
// ============================================================================
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../utils/supabaseClient';
import { desdeFilaBDCompras } from '../../utils/compras/persistencia';
import { getNetworkProfile } from '../../utils/networkProfile';
import { idbGetQuery, idbSetQuery } from '../../utils/queryPersister';
import { fetchAllSupabasePages, SUPABASE_MAX_SELECT_ROWS } from '../../utils/supabasePagination';

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

export function useDocumentosCompras(periodId, enabled = true) {
  return useQuery({
    queryKey: ['comprasDocumentos', periodId],
    queryFn: async () => {
      if (!periodId) return [];

      const cacheKeyHash = JSON.stringify(['comprasDocumentos', periodId]);
      const cachedDocs = await idbGetQuery(cacheKeyHash);
      if (Array.isArray(cachedDocs) && cachedDocs.length > 0) {
        return cachedDocs;
      }

      const net = getNetworkProfile();
      const pageSize = Math.min(net.recommendedBatchSize || SUPABASE_MAX_SELECT_ROWS, SUPABASE_MAX_SELECT_ROWS);
      const concurrency = net.recommendedConcurrency || 4;

      const all = await fetchAllSupabasePages({
        pageSize,
        concurrency,
        label: 'ComprasDocumentosPage',
        fetchPage: (from, to, withCount) =>
          supabase
            .from('detalle_compras')
            .select(COLUMNAS_DETALLE_COMPRAS, withCount ? { count: 'exact' } : undefined)
            .eq('periodo_id', periodId)
            .order('fecha_emision', { ascending: true })
            .order('serie', { ascending: true })
            .order('correlativo', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to),
      });

      if (all.length === 0) return [];

      const docs = all.map(desdeFilaBDCompras);
      idbSetQuery(cacheKeyHash, ['comprasDocumentos', periodId], docs);
      return docs;
    },
    enabled: !!periodId && enabled,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}
