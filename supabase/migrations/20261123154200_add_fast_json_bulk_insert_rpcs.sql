-- ============================================================================
-- RPCs de inserción masiva ultrarrápidas en JSON (json_populate_recordset)
-- - Evita el parseo JSONB del lote completo en memoria antes de insertar
-- - Usa SET LOCAL synchronous_commit = off durante el staging (el publish final
--   en finalizar_periodo_carga mantiene commit síncrono completo)
-- - statement_timeout = 60s para soportar lotes de 2,000 filas sin timeouts
-- ============================================================================

CREATE OR REPLACE FUNCTION public.insertar_lote_ventas_json(
    p_periodo_id UUID,
    p_empresa_id UUID,
    p_filas JSON
) RETURNS INTEGER AS $$
DECLARE
    v_inserted INTEGER;
BEGIN
    IF NOT public.user_has_empresa_access(p_empresa_id) OR public.get_user_rol() NOT IN ('admin', 'operador') THEN
        RAISE EXCEPTION 'No autorizado para insertar registros en esta empresa.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.periodos_carga
        WHERE id = p_periodo_id
          AND empresa_id = p_empresa_id
          AND modulo = 'ventas'
          AND estado = 'procesando'
    ) THEN
        RAISE EXCEPTION 'Período de carga de ventas inválido o no se encuentra en estado procesando.';
    END IF;

    SET LOCAL synchronous_commit = off;

    INSERT INTO public.detalle_ventas (
        periodo_id, empresa_id, car_sunat, serie, correlativo, fecha_emision, tipo_doc_pago,
        tipo_identidad_sap, nro_identidad_sap, nombre_sap,
        base_sap, igv_sap, exonerado_sap, inafecto_sap, otros_sap, total_sap,
        tipo_identidad_sunat, nro_identidad_sunat, nombre_sunat,
        base_sunat, igv_sunat, exonerado_sunat, inafecto_sunat, otros_sunat, total_sunat,
        mensaje_sire, tipo_pago_sire, op_gratuitas, estado_validacion, errores_json
    )
    SELECT
        p_periodo_id, p_empresa_id,
        r.car_sunat, r.serie, r.correlativo, r.fecha_emision, r.tipo_doc_pago,
        r.tipo_identidad_sap, r.nro_identidad_sap, r.nombre_sap,
        COALESCE(r.base_sap, 0), COALESCE(r.igv_sap, 0), COALESCE(r.exonerado_sap, 0),
        COALESCE(r.inafecto_sap, 0), COALESCE(r.otros_sap, 0), COALESCE(r.total_sap, 0),
        r.tipo_identidad_sunat, r.nro_identidad_sunat, r.nombre_sunat,
        COALESCE(r.base_sunat, 0), COALESCE(r.igv_sunat, 0), COALESCE(r.exonerado_sunat, 0),
        COALESCE(r.inafecto_sunat, 0), COALESCE(r.otros_sunat, 0), COALESCE(r.total_sunat, 0),
        r.mensaje_sire, COALESCE(r.tipo_pago_sire, 'NORMAL'), COALESCE(r.op_gratuitas, 0),
        r.estado_validacion, COALESCE(r.errores_json, '[]'::jsonb)
    FROM json_populate_recordset(null::public.detalle_ventas, p_filas) AS r;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN v_inserted;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.insertar_lote_compras_json(
    p_periodo_id UUID,
    p_empresa_id UUID,
    p_filas JSON
) RETURNS INTEGER AS $$
DECLARE
    v_inserted INTEGER;
BEGIN
    IF NOT public.user_has_empresa_access(p_empresa_id) OR public.get_user_rol() NOT IN ('admin', 'operador') THEN
        RAISE EXCEPTION 'No autorizado para insertar registros en esta empresa.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.periodos_carga
        WHERE id = p_periodo_id
          AND empresa_id = p_empresa_id
          AND modulo = 'compras'
          AND estado = 'procesando'
    ) THEN
        RAISE EXCEPTION 'Período de carga de compras inválido o no se encuentra en estado procesando.';
    END IF;

    SET LOCAL synchronous_commit = off;

    INSERT INTO public.detalle_compras (
        periodo_id, empresa_id, car_sunat, ruc_proveedor, serie, correlativo, fecha_emision, tipo_doc_pago,
        tipo_identidad_sap, nro_identidad_sap, nombre_sap,
        base_sap, igv_sap, exonerado_sap, inafecto_sap, otros_sap, total_sap,
        tipo_identidad_sunat, nro_identidad_sunat, nombre_sunat,
        base_sunat, igv_sunat, exonerado_sunat, inafecto_sunat, otros_sunat, total_sunat,
        mensaje_sire, estado_validacion, errores_json
    )
    SELECT
        p_periodo_id, p_empresa_id,
        r.car_sunat, r.ruc_proveedor, r.serie, r.correlativo, r.fecha_emision, r.tipo_doc_pago,
        r.tipo_identidad_sap, r.nro_identidad_sap, r.nombre_sap,
        COALESCE(r.base_sap, 0), COALESCE(r.igv_sap, 0), COALESCE(r.exonerado_sap, 0),
        COALESCE(r.inafecto_sap, 0), COALESCE(r.otros_sap, 0), COALESCE(r.total_sap, 0),
        r.tipo_identidad_sunat, r.nro_identidad_sunat, r.nombre_sunat,
        COALESCE(r.base_sunat, 0), COALESCE(r.igv_sunat, 0), COALESCE(r.exonerado_sunat, 0),
        COALESCE(r.inafecto_sunat, 0), COALESCE(r.otros_sunat, 0), COALESCE(r.total_sunat, 0),
        r.mensaje_sire, r.estado_validacion, COALESCE(r.errores_json, '[]'::jsonb)
    FROM json_populate_recordset(null::public.detalle_compras, p_filas) AS r;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN v_inserted;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public SET statement_timeout = '60s';

REVOKE EXECUTE ON FUNCTION public.insertar_lote_ventas_json(UUID, UUID, JSON) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.insertar_lote_compras_json(UUID, UUID, JSON) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.insertar_lote_ventas_json(UUID, UUID, JSON) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insertar_lote_compras_json(UUID, UUID, JSON) TO authenticated;
