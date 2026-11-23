-- ============================================================================
-- Optimización definitiva de lecturas masivas y Dashboard instantáneo (< 50 ms)
-- 1. Agrega `resumen_json` (JSONB ~3 KB) en `periodos_carga` para abrir el
--    Dashboard en < 50 ms sin descargar 120k+ filas.
-- 2. Convierte `obtener_lote_ventas_json` y `obtener_lote_compras_json` a
--    SECURITY DEFINER con verificación O(1) de `user_has_empresa_access`,
--    eliminando el overhead de RLS fila-por-fila y los timeouts 500.
-- 3. Agrega `guardar_resumen_periodo` para cachear el resumen en BD.
-- ============================================================================

ALTER TABLE public.periodos_carga
    ADD COLUMN IF NOT EXISTS resumen_json JSONB;

CREATE OR REPLACE FUNCTION public.obtener_lote_ventas_json(
    p_periodo_id UUID,
    p_min_id UUID DEFAULT NULL,
    p_max_id UUID DEFAULT NULL,
    p_after_id UUID DEFAULT NULL,
    p_limit INTEGER DEFAULT 2500
) RETURNS JSON AS $$
DECLARE
    v_empresa_id UUID;
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 2500), 1), 5000);
    v_lower UUID := COALESCE(p_min_id, '00000000-0000-0000-0000-000000000000'::uuid);
    v_upper UUID := COALESCE(p_max_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid);
    v_result JSON;
BEGIN
    SELECT empresa_id INTO v_empresa_id
    FROM public.periodos_carga
    WHERE id = p_periodo_id;

    IF v_empresa_id IS NULL THEN
        RETURN '[]'::json;
    END IF;

    IF NOT public.user_has_empresa_access(v_empresa_id) THEN
        RAISE EXCEPTION 'No autorizado para consultar este período de ventas.';
    END IF;

    IF p_after_id IS NOT NULL THEN
        SELECT COALESCE(json_agg(sub), '[]'::json)
        INTO v_result
        FROM (
            SELECT
                dv.id, dv.car_sunat, dv.serie, dv.correlativo, dv.fecha_emision, dv.tipo_doc_pago,
                dv.tipo_identidad_sap, dv.nro_identidad_sap, dv.nombre_sap,
                dv.base_sap, dv.igv_sap, dv.exonerado_sap, dv.inafecto_sap, dv.otros_sap, dv.total_sap,
                dv.tipo_identidad_sunat, dv.nro_identidad_sunat, dv.nombre_sunat,
                dv.base_sunat, dv.igv_sunat, dv.exonerado_sunat, dv.inafecto_sunat, dv.otros_sunat, dv.total_sunat,
                dv.tipo_pago_sire, dv.op_gratuitas, dv.estado_validacion, dv.errores_json
            FROM public.detalle_ventas dv
            WHERE dv.periodo_id = p_periodo_id
              AND dv.id > p_after_id
              AND dv.id <= v_upper
            ORDER BY dv.id ASC
            LIMIT v_limit
        ) sub;
    ELSE
        SELECT COALESCE(json_agg(sub), '[]'::json)
        INTO v_result
        FROM (
            SELECT
                dv.id, dv.car_sunat, dv.serie, dv.correlativo, dv.fecha_emision, dv.tipo_doc_pago,
                dv.tipo_identidad_sap, dv.nro_identidad_sap, dv.nombre_sap,
                dv.base_sap, dv.igv_sap, dv.exonerado_sap, dv.inafecto_sap, dv.otros_sap, dv.total_sap,
                dv.tipo_identidad_sunat, dv.nro_identidad_sunat, dv.nombre_sunat,
                dv.base_sunat, dv.igv_sunat, dv.exonerado_sunat, dv.inafecto_sunat, dv.otros_sunat, dv.total_sunat,
                dv.tipo_pago_sire, dv.op_gratuitas, dv.estado_validacion, dv.errores_json
            FROM public.detalle_ventas dv
            WHERE dv.periodo_id = p_periodo_id
              AND dv.id >= v_lower
              AND dv.id <= v_upper
            ORDER BY dv.id ASC
            LIMIT v_limit
        ) sub;
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.obtener_lote_compras_json(
    p_periodo_id UUID,
    p_min_id UUID DEFAULT NULL,
    p_max_id UUID DEFAULT NULL,
    p_after_id UUID DEFAULT NULL,
    p_limit INTEGER DEFAULT 2500
) RETURNS JSON AS $$
DECLARE
    v_empresa_id UUID;
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 2500), 1), 5000);
    v_lower UUID := COALESCE(p_min_id, '00000000-0000-0000-0000-000000000000'::uuid);
    v_upper UUID := COALESCE(p_max_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid);
    v_result JSON;
BEGIN
    SELECT empresa_id INTO v_empresa_id
    FROM public.periodos_carga
    WHERE id = p_periodo_id;

    IF v_empresa_id IS NULL THEN
        RETURN '[]'::json;
    END IF;

    IF NOT public.user_has_empresa_access(v_empresa_id) THEN
        RAISE EXCEPTION 'No autorizado para consultar este período de compras.';
    END IF;

    IF p_after_id IS NOT NULL THEN
        SELECT COALESCE(json_agg(sub), '[]'::json)
        INTO v_result
        FROM (
            SELECT
                dc.id, dc.car_sunat, dc.ruc_proveedor, dc.serie, dc.correlativo, dc.fecha_emision, dc.tipo_doc_pago,
                dc.tipo_identidad_sap, dc.nro_identidad_sap, dc.nombre_sap,
                dc.base_sap, dc.igv_sap, dc.exonerado_sap, dc.inafecto_sap, dc.otros_sap, dc.total_sap,
                dc.tipo_identidad_sunat, dc.nro_identidad_sunat, dc.nombre_sunat,
                dc.base_sunat, dc.igv_sunat, dc.exonerado_sunat, dc.inafecto_sunat, dc.otros_sunat, dc.total_sunat,
                dc.estado_validacion, dc.errores_json
            FROM public.detalle_compras dc
            WHERE dc.periodo_id = p_periodo_id
              AND dc.id > p_after_id
              AND dc.id <= v_upper
            ORDER BY dc.id ASC
            LIMIT v_limit
        ) sub;
    ELSE
        SELECT COALESCE(json_agg(sub), '[]'::json)
        INTO v_result
        FROM (
            SELECT
                dc.id, dc.car_sunat, dc.ruc_proveedor, dc.serie, dc.correlativo, dc.fecha_emision, dc.tipo_doc_pago,
                dc.tipo_identidad_sap, dc.nro_identidad_sap, dc.nombre_sap,
                dc.base_sap, dc.igv_sap, dc.exonerado_sap, dc.inafecto_sap, dc.otros_sap, dc.total_sap,
                dc.tipo_identidad_sunat, dc.nro_identidad_sunat, dc.nombre_sunat,
                dc.base_sunat, dc.igv_sunat, dc.exonerado_sunat, dc.inafecto_sunat, dc.otros_sunat, dc.total_sunat,
                dc.estado_validacion, dc.errores_json
            FROM public.detalle_compras dc
            WHERE dc.periodo_id = p_periodo_id
              AND dc.id >= v_lower
              AND dc.id <= v_upper
            ORDER BY dc.id ASC
            LIMIT v_limit
        ) sub;
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.guardar_resumen_periodo(
    p_periodo_id UUID,
    p_resumen JSONB
) RETURNS VOID AS $$
DECLARE
    v_empresa_id UUID;
BEGIN
    SELECT empresa_id INTO v_empresa_id
    FROM public.periodos_carga
    WHERE id = p_periodo_id;

    IF v_empresa_id IS NULL THEN
        RETURN;
    END IF;

    IF NOT public.user_has_empresa_access(v_empresa_id) THEN
        RAISE EXCEPTION 'No autorizado para actualizar el resumen de este período.';
    END IF;

    IF pg_column_size(p_resumen) > 32768 THEN
        RAISE EXCEPTION 'El resumen JSON excede el tamaño máximo permitido (32 KB).';
    END IF;

    UPDATE public.periodos_carga
    SET resumen_json = p_resumen
    WHERE id = p_periodo_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

REVOKE EXECUTE ON FUNCTION public.obtener_lote_ventas_json(UUID, UUID, UUID, UUID, INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.obtener_lote_compras_json(UUID, UUID, UUID, UUID, INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.guardar_resumen_periodo(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obtener_lote_ventas_json(UUID, UUID, UUID, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_lote_compras_json(UUID, UUID, UUID, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_resumen_periodo(UUID, JSONB) TO authenticated;
