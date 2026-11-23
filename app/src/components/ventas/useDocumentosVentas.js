// ============================================================================
// Hook de acceso a los documentos conciliados del módulo de Ventas.
// - Pide únicamente las columnas necesarias (evita SELECT *)
// - Lanza en paralelo la descarga de páginas adicionales cuando el lote supera
//   el tamaño de bloque, reduciendo el tiempo de carga en periodos grandes.
// ============================================================================
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../utils/supabaseClient';
import { desdeFilaBD } from '../../utils/ventas/persistencia';
import { enriquecerSecuenciasEnDocs } from '../../utils/ventas/reglas';
import { getNetworkProfile } from '../../utils/networkProfile';
import { idbGetQuery, idbSetQuery } from '../../utils/queryPersister';
import { fetchAllSupabasePages, SUPABASE_MAX_SELECT_ROWS } from '../../utils/supabasePagination';

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

export function useDocumentosVentas(periodId, enabled = true) {
  return useQuery({
    queryKey: ['ventasDocumentos', periodId],
    queryFn: async () => {
      if (!periodId) return [];

      // 0. Verificar primero en caché persistente IndexedDB (restauración en ~20ms tras F5)
      const cacheKeyHash = JSON.stringify(['ventasDocumentos', periodId]);
      const cachedDocs = await idbGetQuery(cacheKeyHash);
      if (Array.isArray(cachedDocs) && cachedDocs.length > 0) {
        return enriquecerSecuenciasEnDocs(cachedDocs);
      }

      const net = getNetworkProfile();
      const pageSize = Math.min(net.recommendedBatchSize || SUPABASE_MAX_SELECT_ROWS, SUPABASE_MAX_SELECT_ROWS);
      const concurrency = net.recommendedConcurrency || 4;

      const all = await fetchAllSupabasePages({
        pageSize,
        concurrency,
        label: 'VentasDocumentosPage',
        fetchPage: (from, to, withCount) =>
          supabase
            .from('detalle_ventas')
            .select(COLUMNAS_DETALLE_VENTAS, withCount ? { count: 'exact' } : undefined)
            .eq('periodo_id', periodId)
            .order('fecha_emision', { ascending: true })
            .order('serie', { ascending: true })
            .order('correlativo', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to),
      });

      if (all.length === 0) return [];

      const docs = enriquecerSecuenciasEnDocs(all.map(desdeFilaBD));
      idbSetQuery(cacheKeyHash, ['ventasDocumentos', periodId], docs);
      return docs;
    },
    enabled: !!periodId && enabled,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}
