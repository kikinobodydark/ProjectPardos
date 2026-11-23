-- ============================================================================
-- Optimización crítica de carga masiva (Ventas y Compras) y RLS O(1) InitPlan
-- Resuelve "canceling statement due to statement timeout" en cargas grandes
-- ============================================================================

-- 1. Schema privado (no expuesto por PostgREST) para helper RLS de empresas permitidas
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.get_user_empresa_ids()
RETURNS UUID[] AS $$
    SELECT COALESCE(ARRAY(
        SELECT e.id
        FROM public.usuarios u
        JOIN public.empresas e ON e.estudio_id = u.estudio_id
        WHERE u.id = (SELECT auth.uid())
          AND u.activo = true
          AND u.rol = 'admin'
        UNION
        SELECT ue.empresa_id
        FROM public.usuarios u
        JOIN public.usuario_empresas ue ON ue.usuario_id = u.id
        JOIN public.empresas e ON e.id = ue.empresa_id AND e.estudio_id = u.estudio_id
        WHERE u.id = (SELECT auth.uid())
          AND u.activo = true
    ), ARRAY[]::UUID[]);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public;

REVOKE ALL ON FUNCTION private.get_user_empresa_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.get_user_empresa_ids() TO authenticated;

-- 2. Deshabilitar / eliminar triggers fila-por-fila heredados en tablas masivas de detalle
DROP TRIGGER IF EXISTS audit_detalle_ventas ON public.detalle_ventas;
DROP TRIGGER IF EXISTS audit_detalle_compras ON public.detalle_compras;

-- 3. Eliminar índices heredados de columna única redundantes en tablas masivas
DROP INDEX IF EXISTS public.idx_detalle_ventas_estado_validacion;
DROP INDEX IF EXISTS public.idx_detalle_ventas_fecha_emision;
DROP INDEX IF EXISTS public.idx_detalle_ventas_serie_correlativo;
DROP INDEX IF EXISTS public.idx_detalle_ventas_tipo_doc_pago;
DROP INDEX IF EXISTS public.idx_detalle_compras_estado_validacion;
DROP INDEX IF EXISTS public.idx_detalle_compras_fecha_emision;
DROP INDEX IF EXISTS public.idx_detalle_compras_serie_correlativo;
DROP INDEX IF EXISTS public.idx_detalle_compras_tipo_doc_pago;

-- 4. Reescribir políticas RLS con InitPlan O(1): empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[])
ALTER POLICY select_empresas ON public.empresas
    USING (
        estudio_id = (SELECT public.get_user_estudio())
        AND (
            (SELECT public.get_user_rol()) = 'admin'
            OR id = ANY((SELECT private.get_user_empresa_ids())::uuid[])
        )
    );

ALTER POLICY select_periodos ON public.periodos_carga
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]));
ALTER POLICY insert_periodos_ops ON public.periodos_carga
    WITH CHECK (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));
ALTER POLICY update_periodos_ops ON public.periodos_carga
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'))
    WITH CHECK (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));
ALTER POLICY delete_periodos_ops ON public.periodos_carga
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));

ALTER POLICY select_detalle_ventas ON public.detalle_ventas
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]));
ALTER POLICY insert_detalle_ventas_ops ON public.detalle_ventas
    WITH CHECK (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));
ALTER POLICY update_detalle_ventas_ops ON public.detalle_ventas
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'))
    WITH CHECK (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));
ALTER POLICY delete_detalle_ventas_ops ON public.detalle_ventas
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));

ALTER POLICY select_detalle_compras ON public.detalle_compras
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]));
ALTER POLICY insert_detalle_compras_ops ON public.detalle_compras
    WITH CHECK (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));
ALTER POLICY update_detalle_compras_ops ON public.detalle_compras
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'))
    WITH CHECK (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));
ALTER POLICY delete_detalle_compras_ops ON public.detalle_compras
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));

ALTER POLICY select_locales_empresa ON public.locales_empresa
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]));
ALTER POLICY insert_locales_empresa_admin ON public.locales_empresa
    WITH CHECK (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) = 'admin');
ALTER POLICY update_locales_empresa_admin ON public.locales_empresa
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) = 'admin')
    WITH CHECK (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) = 'admin');
ALTER POLICY delete_locales_empresa_admin ON public.locales_empresa
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) = 'admin');

ALTER POLICY select_local_series ON public.local_series
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]));
ALTER POLICY insert_local_series_admin ON public.local_series
    WITH CHECK (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) = 'admin');
ALTER POLICY update_local_series_admin ON public.local_series
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) = 'admin')
    WITH CHECK (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) = 'admin');
ALTER POLICY delete_local_series_admin ON public.local_series
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) = 'admin');

-- 5. Aumentar margen de statement_timeout en RPCs de carga masiva y publicación atómica
ALTER FUNCTION public.insertar_lote_ventas(UUID, UUID, JSONB) SET statement_timeout = '30s';
ALTER FUNCTION public.insertar_lote_compras(UUID, UUID, JSONB) SET statement_timeout = '30s';
ALTER FUNCTION public.finalizar_periodo_carga(UUID, INTEGER) SET statement_timeout = '30s';
