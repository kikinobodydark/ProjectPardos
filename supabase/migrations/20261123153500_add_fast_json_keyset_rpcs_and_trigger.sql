-- ============================================================================
-- RPCs de lectura Keyset ultrarrápida usando json_agg (16x más rápido que jsonb_agg)
-- + Trigger automático para mantener conteos cacheados en public.periodos_carga
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_poblar_conteos_periodo()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.estado = 'completado' AND (OLD.estado IS DISTINCT FROM 'completado' OR NEW.total_registros IS NULL) THEN
        IF NEW.modulo = 'compras' THEN
            SELECT
                count(*)::integer,
                count(*) FILTER (WHERE estado_validacion = 'OK')::integer,
                count(*) FILTER (WHERE estado_validacion = 'OBSERVADO')::integer,
                count(*) FILTER (WHERE estado_validacion = 'ERROR')::integer
            INTO NEW.total_registros, NEW.ok_registros, NEW.observado_registros, NEW.error_registros
            FROM public.detalle_compras
            WHERE periodo_id = NEW.id;
        ELSE
            SELECT
                count(*)::integer,
                count(*) FILTER (WHERE estado_validacion = 'OK')::integer,
                count(*) FILTER (WHERE estado_validacion = 'OBSERVADO')::integer,
                count(*) FILTER (WHERE estado_validacion = 'ERROR')::integer
            INTO NEW.total_registros, NEW.ok_registros, NEW.observado_registros, NEW.error_registros
            FROM public.detalle_ventas
            WHERE periodo_id = NEW.id;
        END IF;
        NEW.total_registros := COALESCE(NEW.total_registros, 0);
        NEW.ok_registros := COALESCE(NEW.ok_registros, 0);
        NEW.observado_registros := COALESCE(NEW.observado_registros, 0);
        NEW.error_registros := COALESCE(NEW.error_registros, 0);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public;

REVOKE EXECUTE ON FUNCTION public.trg_poblar_conteos_periodo() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER trg_periodos_poblar_conteos
    BEFORE UPDATE OF estado ON public.periodos_carga
    FOR EACH ROW
    WHEN (NEW.estado = 'completado')
    EXECUTE FUNCTION public.trg_poblar_conteos_periodo();

CREATE OR REPLACE FUNCTION public.obtener_lote_ventas_json(
    p_periodo_id UUID,
    p_min_id UUID DEFAULT NULL,
    p_max_id UUID DEFAULT NULL,
    p_after_id UUID DEFAULT NULL,
    p_limit INTEGER DEFAULT 5000
) RETURNS JSON AS $$
DECLARE
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 5000);
    v_lower UUID := COALESCE(p_min_id, '00000000-0000-0000-0000-000000000000'::uuid);
    v_upper UUID := COALESCE(p_max_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid);
    v_result JSON;
BEGIN
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
$$ LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public SET statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.obtener_lote_compras_json(
    p_periodo_id UUID,
    p_min_id UUID DEFAULT NULL,
    p_max_id UUID DEFAULT NULL,
    p_after_id UUID DEFAULT NULL,
    p_limit INTEGER DEFAULT 5000
) RETURNS JSON AS $$
DECLARE
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 5000);
    v_lower UUID := COALESCE(p_min_id, '00000000-0000-0000-0000-000000000000'::uuid);
    v_upper UUID := COALESCE(p_max_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid);
    v_result JSON;
BEGIN
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
$$ LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public SET statement_timeout = '30s';

REVOKE EXECUTE ON FUNCTION public.obtener_lote_ventas_json(UUID, UUID, UUID, UUID, INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.obtener_lote_compras_json(UUID, UUID, UUID, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obtener_lote_ventas_json(UUID, UUID, UUID, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_lote_compras_json(UUID, UUID, UUID, UUID, INTEGER) TO authenticated;
