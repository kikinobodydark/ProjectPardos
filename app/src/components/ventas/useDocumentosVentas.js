// ============================================================================
// Hook de acceso a los documentos conciliados del módulo de Ventas.
// Carga una sola vez todos los registros del período seleccionado desde
// public.detalle_ventas (en bloques de 1000) y los reconstruye en memoria.
// De este modo los filtros, indicadores y reportes operan sin re-ejecutar las
// reglas ni consultar la red en cada cambio visual.
// ============================================================================
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../utils/supabaseClient';
import { desdeFilaBD } from '../../utils/ventas/persistencia';

export function useDocumentosVentas(periodId, enabled = true) {
  return useQuery({
    queryKey: ['ventasDocumentos', periodId],
    queryFn: async () => {
      if (!periodId) return [];
      const pageSize = 1000;
      let page = 0;
      let all = [];
      let more = true;
      while (more) {
        const { data, error } = await supabase
          .from('detalle_ventas')
          .select('*')
          .eq('periodo_id', periodId)
          .order('fecha_emision', { ascending: true })
          .order('serie', { ascending: true })
          .order('correlativo', { ascending: true })
          .range(page * pageSize, (page + 1) * pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) {
          more = false;
        } else {
          all = all.concat(data);
          if (data.length < pageSize) more = false;
          else page += 1;
        }
      }
      return all.map(desdeFilaBD);
    },
    enabled: !!periodId && enabled,
    staleTime: 5 * 60 * 1000,
  });
}
