// ============================================================================
// Hook de acceso a los documentos conciliados del módulo de Ventas.
// - Pide únicamente las columnas necesarias (evita SELECT *)
// - Lanza en paralelo la descarga de páginas adicionales cuando el lote supera
//   el tamaño de bloque, reduciendo el tiempo de carga en periodos grandes.
// ============================================================================
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../utils/supabaseClient';
import { desdeFilaBD } from '../../utils/ventas/persistencia';
import { getNetworkProfile } from '../../utils/networkProfile';

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
      const net = getNetworkProfile();
      const pageSize = net.recommendedBatchSize || 1000;

      // 1. Primera página con conteo exacto
      const { data: firstPage, count, error } = await supabase
        .from('detalle_ventas')
        .select(COLUMNAS_DETALLE_VENTAS, { count: 'exact' })
        .eq('periodo_id', periodId)
        .order('fecha_emision', { ascending: true })
        .order('serie', { ascending: true })
        .order('correlativo', { ascending: true })
        .range(0, pageSize - 1);

      if (error) throw error;
      if (!firstPage || firstPage.length === 0) return [];

      let all = [...firstPage];
      const total = count ?? firstPage.length;

      // 2. Si hay más páginas, lanzar las peticiones restantes en paralelo
      if (total > pageSize && firstPage.length === pageSize) {
        const totalPages = Math.ceil(total / pageSize);
        const pagePromises = [];
        for (let p = 1; p < totalPages; p++) {
          pagePromises.push(
            supabase
              .from('detalle_ventas')
              .select(COLUMNAS_DETALLE_VENTAS)
              .eq('periodo_id', periodId)
              .order('fecha_emision', { ascending: true })
              .order('serie', { ascending: true })
              .order('correlativo', { ascending: true })
              .range(p * pageSize, (p + 1) * pageSize - 1)
          );
        }

        const results = await Promise.all(pagePromises);
        for (const res of results) {
          if (res.error) throw res.error;
          if (res.data && res.data.length > 0) {
            all = all.concat(res.data);
          }
        }
      }

      return all.map(desdeFilaBD);
    },
    enabled: !!periodId && enabled,
    staleTime: 5 * 60 * 1000,
  });
}
