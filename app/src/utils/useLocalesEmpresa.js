// ============================================================================
// Hook de React Query para Locales y Series por Empresa.
// Re-exporta las utilidades puras de ./locales.js para comodidad en componentes.
// ============================================================================
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabaseClient.js';
import {
  TIPOS_SERIE_LOCAL,
  normalizarSerie,
  normalizarLocales,
  construirIndiceLocales,
  coincideConLocal,
} from './locales.js';

export {
  TIPOS_SERIE_LOCAL,
  normalizarSerie,
  normalizarLocales,
  construirIndiceLocales,
  coincideConLocal,
};

export function useLocalesEmpresa(empresaId, enabled = true) {
  const query = useQuery({
    queryKey: ['localesEmpresa', empresaId],
    queryFn: async () => {
      if (!empresaId) return [];
      const { data, error } = await supabase
        .from('locales_empresa')
        .select('id, empresa_id, nombre, activo, local_series(id, tipo_doc_pago, serie)')
        .eq('empresa_id', empresaId)
        .order('nombre', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!empresaId && enabled,
    staleTime: 5 * 60 * 1000,
  });

  const locales = useMemo(() => normalizarLocales(query.data || []), [query.data]);
  const indiceLocales = useMemo(() => construirIndiceLocales(locales), [locales]);

  return {
    ...query,
    locales,
    localesActivos: indiceLocales.localesActivos,
    indiceLocales,
  };
}
