-- ============================================================================
-- Optimización de lectura de Historial y consultas masivas (hasta 200 MB / 200k+ filas)
-- 1. Cachea conteos de resumen en public.periodos_carga para que Historial cargue en <5 ms
-- 2. Reescribe v_historial_cargas sin escanear v_resumen_ventas / v_resumen_compras completos
-- 3. Agrega índices compuestos (periodo_id, id) y RPCs keyset JSONB (sin OFFSET O(N²))
-- ============================================================================

-- 1. Columnas cacheadas de resumen en periodos_carga
ALTER TABLE public.periodos_carga
    ADD COLUMN IF NOT EXISTS total_registros INTEGER,
    ADD COLUMN IF NOT EXISTS ok_registros INTEGER,
    ADD COLUMN IF NOT EXISTS observado_registros INTEGER,
    ADD COLUMN IF NOT EXISTS error_registros INTEGER;

-- Backfill de conteos para períodos existentes de Ventas (usa idx_detalle_ventas_periodo_estado)
UPDATE public.periodos_carga pc
SET
    total_registros = COALESCE(agg.total_registros, 0),
    ok_registros = COALESCE(agg.ok_registros, 0),
    observado_registros = COALESCE(agg.observado_registros, 0),
    error_registros = COALESCE(agg.error_registros, 0)
FROM (
    SELECT
        dv.periodo_id,
        count(*)::integer AS total_registros,
        count(*) FILTER (WHERE dv.estado_validacion = 'OK')::integer AS ok_registros,
        count(*) FILTER (WHERE dv.estado_validacion = 'OBSERVADO')::integer AS observado_registros,
        count(*) FILTER (WHERE dv.estado_validacion = 'ERROR')::integer AS error_registros
    FROM public.detalle_ventas dv
    GROUP BY dv.periodo_id
) agg
WHERE pc.id = agg.periodo_id
  AND pc.modulo IS DISTINCT FROM 'compras'
  AND pc.total_registros IS NULL;

-- Backfill de conteos para períodos existentes de Compras (usa idx_detalle_compras_periodo_estado)
UPDATE public.periodos_carga pc
SET
    total_registros = COALESCE(agg.total_registros, 0),
    ok_registros = COALESCE(agg.ok_registros, 0),
    observado_registros = COALESCE(agg.observado_registros, 0),
    error_registros = COALESCE(agg.error_registros, 0)
FROM (
    SELECT
        dc.periodo_id,
        count(*)::integer AS total_registros,
        count(*) FILTER (WHERE dc.estado_validacion = 'OK')::integer AS ok_registros,
        count(*) FILTER (WHERE dc.estado_validacion = 'OBSERVADO')::integer AS observado_registros,
        count(*) FILTER (WHERE dc.estado_validacion = 'ERROR')::integer AS error_registros
    FROM public.detalle_compras dc
    GROUP BY dc.periodo_id
) agg
WHERE pc.id = agg.periodo_id
  AND pc.modulo = 'compras'
  AND pc.total_registros IS NULL;

-- Períodos completados sin filas de detalle quedan en 0
UPDATE public.periodos_carga
SET
    total_registros = COALESCE(total_registros, 0),
    ok_registros = COALESCE(ok_registros, 0),
    observado_registros = COALESCE(observado_registros, 0),
    error_registros = COALESCE(error_registros, 0)
WHERE estado = 'completado'
  AND total_registros IS NULL;

-- 2. Limpiar índices heredados redundantes y crear índices compuestos (periodo_id, id) para paginación Keyset O(log N)
DROP INDEX IF EXISTS public.idx_detalle_ventas_estado_validacion;
DROP INDEX IF EXISTS public.idx_detalle_ventas_fecha_emision;
DROP INDEX IF EXISTS public.idx_detalle_ventas_serie_correlativo;
DROP INDEX IF EXISTS public.idx_detalle_ventas_tipo_doc_pago;
DROP INDEX IF EXISTS public.idx_detalle_compras_estado_validacion;
DROP INDEX IF EXISTS public.idx_detalle_compras_fecha_emision;
DROP INDEX IF EXISTS public.idx_detalle_compras_serie_correlativo;
DROP INDEX IF EXISTS public.idx_detalle_compras_tipo_doc_pago;

CREATE INDEX IF NOT EXISTS idx_detalle_ventas_periodo_id_pk
    ON public.detalle_ventas (periodo_id, id);

CREATE INDEX IF NOT EXISTS idx_detalle_compras_periodo_id_pk
    ON public.detalle_compras (periodo_id, id);

-- 3. Actualizar finalizar_periodo_carga para calcular y persistir los 4 conteos una sola vez
CREATE OR REPLACE FUNCTION public.finalizar_periodo_carga(
    p_periodo_id UUID,
    p_target_version INTEGER
) RETURNS UUID AS $$
DECLARE
    v_row public.periodos_carga%ROWTYPE;
    v_total INTEGER := 0;
    v_ok INTEGER := 0;
    v_obs INTEGER := 0;
    v_err INTEGER := 0;
BEGIN
    IF p_target_version IS NULL OR p_target_version < 1 THEN
        RAISE EXCEPTION 'La versión objetivo debe ser un entero positivo.';
    END IF;

    SELECT * INTO v_row FROM public.periodos_carga WHERE id = p_periodo_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Período de carga no encontrado.';
    END IF;

    IF NOT public.user_has_empresa_access(v_row.empresa_id) OR public.get_user_rol() NOT IN ('admin', 'operador') THEN
        RAISE EXCEPTION 'No autorizado para finalizar este período de carga.';
    END IF;

    IF v_row.modulo = 'compras' THEN
        SELECT
            count(*)::integer,
            count(*) FILTER (WHERE estado_validacion = 'OK')::integer,
            count(*) FILTER (WHERE estado_validacion = 'OBSERVADO')::integer,
            count(*) FILTER (WHERE estado_validacion = 'ERROR')::integer
        INTO v_total, v_ok, v_obs, v_err
        FROM public.detalle_compras
        WHERE periodo_id = p_periodo_id;
    ELSE
        SELECT
            count(*)::integer,
            count(*) FILTER (WHERE estado_validacion = 'OK')::integer,
            count(*) FILTER (WHERE estado_validacion = 'OBSERVADO')::integer,
            count(*) FILTER (WHERE estado_validacion = 'ERROR')::integer
        INTO v_total, v_ok, v_obs, v_err
        FROM public.detalle_ventas
        WHERE periodo_id = p_periodo_id;
    END IF;

    DELETE FROM public.periodos_carga
    WHERE id <> p_periodo_id
      AND empresa_id = v_row.empresa_id
      AND periodo = v_row.periodo
      AND dia IS NOT DISTINCT FROM v_row.dia
      AND version = p_target_version
      AND modulo = v_row.modulo;

    UPDATE public.periodos_carga
    SET
        version = p_target_version,
        estado = 'completado',
        total_registros = COALESCE(v_total, 0),
        ok_registros = COALESCE(v_ok, 0),
        observado_registros = COALESCE(v_obs, 0),
        error_registros = COALESCE(v_err, 0)
    WHERE id = p_periodo_id;

    RETURN p_periodo_id;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public SET statement_timeout = '30s';

-- 4. Reescribir v_historial_cargas: lectura O(1) desde periodos_carga + fallback LATERAL index-only
CREATE OR REPLACE VIEW public.v_historial_cargas
WITH (security_invoker = true) AS
SELECT
    pc.id AS periodo_id,
    pc.periodo,
    pc.dia,
    pc.version,
    pc.fecha_carga,
    pc.estado AS estado_carga,
    pc.modulo,
    e.razon_social AS empresa_nombre,
    pc.empresa_id,
    u.nombre AS usuario_nombre,
    COALESCE(pc.total_registros::bigint, fallback.total_registros, 0::bigint) AS total_registros,
    COALESCE(pc.ok_registros::bigint, fallback.ok_registros, 0::bigint) AS ok_registros,
    COALESCE(pc.error_registros::bigint, fallback.error_registros, 0::bigint) AS error_registros,
    COALESCE(pc.observado_registros::bigint, fallback.observado_registros, 0::bigint) AS observado_registros
FROM public.periodos_carga pc
JOIN public.empresas e ON pc.empresa_id = e.id
LEFT JOIN public.usuarios u ON pc.usuario_id = u.id
LEFT JOIN LATERAL (
    SELECT
        count(*) AS total_registros,
        count(*) FILTER (WHERE estado_validacion = 'OK') AS ok_registros,
        count(*) FILTER (WHERE estado_validacion = 'ERROR') AS error_registros,
        count(*) FILTER (WHERE estado_validacion = 'OBSERVADO') AS observado_registros
    FROM public.detalle_ventas dv
    WHERE pc.total_registros IS NULL
      AND pc.modulo IS DISTINCT FROM 'compras'
      AND dv.periodo_id = pc.id
    UNION ALL
    SELECT
        count(*) AS total_registros,
        count(*) FILTER (WHERE estado_validacion = 'OK') AS ok_registros,
        count(*) FILTER (WHERE estado_validacion = 'ERROR') AS error_registros,
        count(*) FILTER (WHERE estado_validacion = 'OBSERVADO') AS observado_registros
    FROM public.detalle_compras dc
    WHERE pc.total_registros IS NULL
      AND pc.modulo = 'compras'
      AND dc.periodo_id = pc.id
) fallback ON pc.total_registros IS NULL
ORDER BY pc.fecha_carga DESC, pc.version DESC;

-- 5. RPCs de lectura Keyset por lotes JSONB (hasta 5,000 filas por petición, sin OFFSET O(N²))
CREATE OR REPLACE FUNCTION public.obtener_lote_ventas_keyset(
    p_periodo_id UUID,
    p_min_id UUID DEFAULT NULL,
    p_max_id UUID DEFAULT NULL,
    p_after_id UUID DEFAULT NULL,
    p_limit INTEGER DEFAULT 5000
) RETURNS JSONB AS $$
DECLARE
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 5000);
    v_lower UUID := COALESCE(p_min_id, '00000000-0000-0000-0000-000000000000'::uuid);
    v_upper UUID := COALESCE(p_max_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid);
    v_result JSONB;
BEGIN
    IF p_after_id IS NOT NULL THEN
        SELECT COALESCE(jsonb_agg(sub.row_data ORDER BY sub.row_id), '[]'::jsonb)
        INTO v_result
        FROM (
            SELECT
                dv.id AS row_id,
                jsonb_build_object(
                    'id', dv.id,
                    'car_sunat', dv.car_sunat,
                    'serie', dv.serie,
                    'correlativo', dv.correlativo,
                    'fecha_emision', dv.fecha_emision,
                    'tipo_doc_pago', dv.tipo_doc_pago,
                    'tipo_identidad_sap', dv.tipo_identidad_sap,
                    'nro_identidad_sap', dv.nro_identidad_sap,
                    'nombre_sap', dv.nombre_sap,
                    'base_sap', dv.base_sap,
                    'igv_sap', dv.igv_sap,
                    'exonerado_sap', dv.exonerado_sap,
                    'inafecto_sap', dv.inafecto_sap,
                    'otros_sap', dv.otros_sap,
                    'total_sap', dv.total_sap,
                    'tipo_identidad_sunat', dv.tipo_identidad_sunat,
                    'nro_identidad_sunat', dv.nro_identidad_sunat,
                    'nombre_sunat', dv.nombre_sunat,
                    'base_sunat', dv.base_sunat,
                    'igv_sunat', dv.igv_sunat,
                    'exonerado_sunat', dv.exonerado_sunat,
                    'inafecto_sunat', dv.inafecto_sunat,
                    'otros_sunat', dv.otros_sunat,
                    'total_sunat', dv.total_sunat,
                    'tipo_pago_sire', dv.tipo_pago_sire,
                    'op_gratuitas', dv.op_gratuitas,
                    'estado_validacion', dv.estado_validacion,
                    'errores_json', dv.errores_json
                ) AS row_data
            FROM public.detalle_ventas dv
            WHERE dv.periodo_id = p_periodo_id
              AND dv.id > p_after_id
              AND dv.id <= v_upper
            ORDER BY dv.id ASC
            LIMIT v_limit
        ) sub;
    ELSE
        SELECT COALESCE(jsonb_agg(sub.row_data ORDER BY sub.row_id), '[]'::jsonb)
        INTO v_result
        FROM (
            SELECT
                dv.id AS row_id,
                jsonb_build_object(
                    'id', dv.id,
                    'car_sunat', dv.car_sunat,
                    'serie', dv.serie,
                    'correlativo', dv.correlativo,
                    'fecha_emision', dv.fecha_emision,
                    'tipo_doc_pago', dv.tipo_doc_pago,
                    'tipo_identidad_sap', dv.tipo_identidad_sap,
                    'nro_identidad_sap', dv.nro_identidad_sap,
                    'nombre_sap', dv.nombre_sap,
                    'base_sap', dv.base_sap,
                    'igv_sap', dv.igv_sap,
                    'exonerado_sap', dv.exonerado_sap,
                    'inafecto_sap', dv.inafecto_sap,
                    'otros_sap', dv.otros_sap,
                    'total_sap', dv.total_sap,
                    'tipo_identidad_sunat', dv.tipo_identidad_sunat,
                    'nro_identidad_sunat', dv.nro_identidad_sunat,
                    'nombre_sunat', dv.nombre_sunat,
                    'base_sunat', dv.base_sunat,
                    'igv_sunat', dv.igv_sunat,
                    'exonerado_sunat', dv.exonerado_sunat,
                    'inafecto_sunat', dv.inafecto_sunat,
                    'otros_sunat', dv.otros_sunat,
                    'total_sunat', dv.total_sunat,
                    'tipo_pago_sire', dv.tipo_pago_sire,
                    'op_gratuitas', dv.op_gratuitas,
                    'estado_validacion', dv.estado_validacion,
                    'errores_json', dv.errores_json
                ) AS row_data
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

CREATE OR REPLACE FUNCTION public.obtener_lote_compras_keyset(
    p_periodo_id UUID,
    p_min_id UUID DEFAULT NULL,
    p_max_id UUID DEFAULT NULL,
    p_after_id UUID DEFAULT NULL,
    p_limit INTEGER DEFAULT 5000
) RETURNS JSONB AS $$
DECLARE
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 5000);
    v_lower UUID := COALESCE(p_min_id, '00000000-0000-0000-0000-000000000000'::uuid);
    v_upper UUID := COALESCE(p_max_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid);
    v_result JSONB;
BEGIN
    IF p_after_id IS NOT NULL THEN
        SELECT COALESCE(jsonb_agg(sub.row_data ORDER BY sub.row_id), '[]'::jsonb)
        INTO v_result
        FROM (
            SELECT
                dc.id AS row_id,
                jsonb_build_object(
                    'id', dc.id,
                    'car_sunat', dc.car_sunat,
                    'ruc_proveedor', dc.ruc_proveedor,
                    'serie', dc.serie,
                    'correlativo', dc.correlativo,
                    'fecha_emision', dc.fecha_emision,
                    'tipo_doc_pago', dc.tipo_doc_pago,
                    'tipo_identidad_sap', dc.tipo_identidad_sap,
                    'nro_identidad_sap', dc.nro_identidad_sap,
                    'nombre_sap', dc.nombre_sap,
                    'base_sap', dc.base_sap,
                    'igv_sap', dc.igv_sap,
                    'exonerado_sap', dc.exonerado_sap,
                    'inafecto_sap', dc.inafecto_sap,
                    'otros_sap', dc.otros_sap,
                    'total_sap', dc.total_sap,
                    'tipo_identidad_sunat', dc.tipo_identidad_sunat,
                    'nro_identidad_sunat', dc.nro_identidad_sunat,
                    'nombre_sunat', dc.nombre_sunat,
                    'base_sunat', dc.base_sunat,
                    'igv_sunat', dc.igv_sunat,
                    'exonerado_sunat', dc.exonerado_sunat,
                    'inafecto_sunat', dc.inafecto_sunat,
                    'otros_sunat', dc.otros_sunat,
                    'total_sunat', dc.total_sunat,
                    'estado_validacion', dc.estado_validacion,
                    'errores_json', dc.errores_json
                ) AS row_data
            FROM public.detalle_compras dc
            WHERE dc.periodo_id = p_periodo_id
              AND dc.id > p_after_id
              AND dc.id <= v_upper
            ORDER BY dc.id ASC
            LIMIT v_limit
        ) sub;
    ELSE
        SELECT COALESCE(jsonb_agg(sub.row_data ORDER BY sub.row_id), '[]'::jsonb)
        INTO v_result
        FROM (
            SELECT
                dc.id AS row_id,
                jsonb_build_object(
                    'id', dc.id,
                    'car_sunat', dc.car_sunat,
                    'ruc_proveedor', dc.ruc_proveedor,
                    'serie', dc.serie,
                    'correlativo', dc.correlativo,
                    'fecha_emision', dc.fecha_emision,
                    'tipo_doc_pago', dc.tipo_doc_pago,
                    'tipo_identidad_sap', dc.tipo_identidad_sap,
                    'nro_identidad_sap', dc.nro_identidad_sap,
                    'nombre_sap', dc.nombre_sap,
                    'base_sap', dc.base_sap,
                    'igv_sap', dc.igv_sap,
                    'exonerado_sap', dc.exonerado_sap,
                    'inafecto_sap', dc.inafecto_sap,
                    'otros_sap', dc.otros_sap,
                    'total_sap', dc.total_sap,
                    'tipo_identidad_sunat', dc.tipo_identidad_sunat,
                    'nro_identidad_sunat', dc.nro_identidad_sunat,
                    'nombre_sunat', dc.nombre_sunat,
                    'base_sunat', dc.base_sunat,
                    'igv_sunat', dc.igv_sunat,
                    'exonerado_sunat', dc.exonerado_sunat,
                    'inafecto_sunat', dc.inafecto_sunat,
                    'otros_sunat', dc.otros_sunat,
                    'total_sunat', dc.total_sunat,
                    'estado_validacion', dc.estado_validacion,
                    'errores_json', dc.errores_json
                ) AS row_data
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

REVOKE EXECUTE ON FUNCTION public.obtener_lote_ventas_keyset(UUID, UUID, UUID, UUID, INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.obtener_lote_compras_keyset(UUID, UUID, UUID, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obtener_lote_ventas_keyset(UUID, UUID, UUID, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_lote_compras_keyset(UUID, UUID, UUID, UUID, INTEGER) TO authenticated;
