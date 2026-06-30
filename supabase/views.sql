-- Vista 1: Resumen agrupado por período (Enfuerza RLS con security_invoker = true)
CREATE OR REPLACE VIEW public.v_resumen_validacion 
WITH (security_invoker = true) AS
SELECT
    periodo_id,
    count(*) as total_registros,
    count(*) FILTER (WHERE estado_validacion = 'OK') as ok_registros,
    count(*) FILTER (WHERE estado_validacion = 'ERROR') as error_registros,
    count(*) FILTER (WHERE estado_validacion = 'OBSERVADO') as observado_registros,
    sum(base_sap) as sum_base_sap,
    sum(igv_sap) as sum_igv_sap,
    sum(otros_sap) as sum_otros_sap,
    sum(total_sap) as sum_total_sap,
    sum(base_sunat) as sum_base_sunat,
    sum(igv_sunat) as sum_igv_sunat,
    sum(otros_sunat) as sum_otros_sunat,
    sum(total_sunat) as sum_total_sunat,
    sum(base_sap) - sum(base_sunat) as diff_base,
    sum(igv_sap) - sum(igv_sunat) as diff_igv,
    sum(otros_sap) - sum(otros_sunat) as diff_otros,
    sum(total_sap) - sum(total_sunat) as diff_total
FROM public.detalle_validacion
GROUP BY periodo_id;

-- Vista 2: Detalle unificado con filtros aplicables para errores (Enfuerza RLS)
CREATE OR REPLACE VIEW public.v_detalle_con_errores 
WITH (security_invoker = true) AS
SELECT
    dv.*,
    pc.periodo,
    pc.empresa_id,
    e.razon_social as empresa_razon_social
FROM public.detalle_validacion dv
JOIN public.periodos_carga pc ON dv.periodo_id = pc.id
JOIN public.empresas e ON pc.empresa_id = e.id
WHERE dv.estado_validacion IN ('ERROR', 'OBSERVADO');

-- Vista 3: Historial detallado de cargas (Enfuerza RLS)
DROP VIEW IF EXISTS public.v_historial_cargas;
CREATE OR REPLACE VIEW public.v_historial_cargas 
WITH (security_invoker = true) AS
SELECT
    pc.id as periodo_id,
    pc.periodo,
    pc.dia,
    pc.version,
    pc.fecha_carga,
    pc.estado as estado_carga,
    e.razon_social as empresa_nombre,
    pc.empresa_id,
    u.nombre as usuario_nombre,
    (SELECT count(*) FROM public.detalle_validacion dv WHERE dv.periodo_id = pc.id) as total_registros,
    (SELECT count(*) FROM public.detalle_validacion dv WHERE dv.periodo_id = pc.id AND dv.estado_validacion = 'OK') as ok_registros,
    (SELECT count(*) FROM public.detalle_validacion dv WHERE dv.periodo_id = pc.id AND dv.estado_validacion = 'ERROR') as error_registros,
    (SELECT count(*) FROM public.detalle_validacion dv WHERE dv.periodo_id = pc.id AND dv.estado_validacion = 'OBSERVADO') as observado_registros
FROM public.periodos_carga pc
JOIN public.empresas e ON pc.empresa_id = e.id
LEFT JOIN public.usuarios u ON pc.usuario_id = u.id
ORDER BY pc.fecha_carga DESC, pc.version DESC;
