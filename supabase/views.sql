-- Vista 1: Resumen de validación de ventas
CREATE OR REPLACE VIEW public.v_resumen_ventas 
WITH (security_invoker = true) AS
 SELECT periodo_id,
    count(*) AS total_registros,
    count(*) FILTER (WHERE estado_validacion::text = 'OK'::text) AS ok_registros,
    count(*) FILTER (WHERE estado_validacion::text = 'ERROR'::text) AS error_registros,
    count(*) FILTER (WHERE estado_validacion::text = 'OBSERVADO'::text) AS observado_registros,
    sum(base_sap) AS sum_base_sap,
    sum(igv_sap) AS sum_igv_sap,
    sum(exonerado_sap) AS sum_exonerado_sap,
    sum(inafecto_sap) AS sum_inafecto_sap,
    sum(otros_sap) AS sum_otros_sap,
    sum(total_sap) AS sum_total_sap,
    sum(base_sunat) AS sum_base_sunat,
    sum(igv_sunat) AS sum_igv_sunat,
    sum(exonerado_sunat) AS sum_exonerado_sunat,
    sum(inafecto_sunat) AS sum_inafecto_sunat,
    sum(otros_sunat) AS sum_otros_sunat,
    sum(total_sunat) AS sum_total_sunat,
    sum(base_sap) - sum(base_sunat) AS diff_base,
    sum(igv_sap) - sum(igv_sunat) AS diff_igv,
    sum(exonerado_sap) - sum(exonerado_sunat) AS diff_exonerado,
    sum(inafecto_sap) - sum(inafecto_sunat) AS diff_inafecto,
    sum(otros_sap) - sum(otros_sunat) AS diff_otros,
    sum(total_sap) - sum(total_sunat) AS diff_total
   FROM public.detalle_ventas
  GROUP BY periodo_id;

-- Vista 2: Resumen de validación de compras
CREATE OR REPLACE VIEW public.v_resumen_compras 
WITH (security_invoker = true) AS
 SELECT periodo_id,
    count(*) AS total_registros,
    count(*) FILTER (WHERE estado_validacion::text = 'OK'::text) AS ok_registros,
    count(*) FILTER (WHERE estado_validacion::text = 'ERROR'::text) AS error_registros,
    count(*) FILTER (WHERE estado_validacion::text = 'OBSERVADO'::text) AS observado_registros,
    sum(base_sap) AS sum_base_sap,
    sum(igv_sap) AS sum_igv_sap,
    sum(exonerado_sap) AS sum_exonerado_sap,
    sum(inafecto_sap) AS sum_inafecto_sap,
    sum(otros_sap) AS sum_otros_sap,
    sum(total_sap) AS sum_total_sap,
    sum(base_sunat) AS sum_base_sunat,
    sum(igv_sunat) AS sum_igv_sunat,
    sum(exonerado_sunat) AS sum_exonerado_sunat,
    sum(inafecto_sunat) AS sum_inafecto_sunat,
    sum(otros_sunat) AS sum_otros_sunat,
    sum(total_sunat) AS sum_total_sunat,
    sum(base_sap) - sum(base_sunat) AS diff_base,
    sum(igv_sap) - sum(igv_sunat) AS diff_igv,
    sum(exonerado_sap) - sum(exonerado_sunat) AS diff_exonerado,
    sum(inafecto_sap) - sum(inafecto_sunat) AS diff_inafecto,
    sum(otros_sap) - sum(otros_sunat) AS diff_otros,
    sum(total_sap) - sum(total_sunat) AS diff_total
   FROM public.detalle_compras
  GROUP BY periodo_id;

-- Vista 3: Detalle de errores y observaciones en ventas
CREATE OR REPLACE VIEW public.v_detalle_errores_ventas 
WITH (security_invoker = true) AS
 SELECT dv.id,
    dv.periodo_id,
    dv.car_sunat,
    dv.serie,
    dv.correlativo,
    dv.fecha_emision,
    dv.tipo_doc_pago,
    dv.tipo_identidad_sap,
    dv.nro_identidad_sap,
    dv.nombre_sap,
    dv.base_sap,
    dv.igv_sap,
    dv.otros_sap,
    dv.total_sap,
    dv.tipo_identidad_sunat,
    dv.nro_identidad_sunat,
    dv.nombre_sunat,
    dv.base_sunat,
    dv.igv_sunat,
    dv.otros_sunat,
    dv.total_sunat,
    dv.mensaje_sire,
    dv.tipo_pago_sire,
    dv.estado_validacion,
    dv.errores_json,
    dv.created_at,
    dv.exonerado_sap,
    dv.exonerado_sunat,
    dv.inafecto_sap,
    dv.inafecto_sunat,
    dv.buscar_documento,
    dv.correlativo_int,
    pc.periodo,
    pc.empresa_id,
    pc.modulo,
    e.razon_social AS empresa_razon_social
   FROM public.detalle_ventas dv
     JOIN public.periodos_carga pc ON dv.periodo_id = pc.id
     JOIN public.empresas e ON pc.empresa_id = e.id
  WHERE dv.estado_validacion::text = ANY (ARRAY['ERROR'::character varying, 'OBSERVADO'::character varying]::text[]);

-- Vista 4: Detalle de errores y observaciones en compras
CREATE OR REPLACE VIEW public.v_detalle_errores_compras 
WITH (security_invoker = true) AS
 SELECT dv.id,
    dv.periodo_id,
    dv.car_sunat,
    dv.ruc_proveedor,
    dv.serie,
    dv.correlativo,
    dv.fecha_emision,
    dv.tipo_doc_pago,
    dv.tipo_identidad_sap,
    dv.nro_identidad_sap,
    dv.nombre_sap,
    dv.base_sap,
    dv.igv_sap,
    dv.exonerado_sap,
    dv.inafecto_sap,
    dv.otros_sap,
    dv.total_sap,
    dv.tipo_identidad_sunat,
    dv.nro_identidad_sunat,
    dv.nombre_sunat,
    dv.base_sunat,
    dv.igv_sunat,
    dv.exonerado_sunat,
    dv.inafecto_sunat,
    dv.otros_sunat,
    dv.total_sunat,
    dv.mensaje_sire,
    dv.estado_validacion,
    dv.errores_json,
    dv.created_at,
    dv.correlativo_int,
    dv.buscar_documento,
    pc.periodo,
    pc.empresa_id,
    pc.modulo,
    e.razon_social AS empresa_razon_social
   FROM public.detalle_compras dv
     JOIN public.periodos_carga pc ON dv.periodo_id = pc.id
     JOIN public.empresas e ON pc.empresa_id = e.id
  WHERE dv.estado_validacion::text = ANY (ARRAY['ERROR'::character varying, 'OBSERVADO'::character varying]::text[]);

-- Vista 5: Historial detallado de cargas
CREATE OR REPLACE VIEW public.v_historial_cargas 
WITH (security_invoker = true) AS
 SELECT pc.id AS periodo_id,
    pc.periodo,
    pc.dia,
    pc.version,
    pc.fecha_carga,
    pc.estado AS estado_carga,
    pc.modulo,
    e.razon_social AS empresa_nombre,
    pc.empresa_id,
    u.nombre AS usuario_nombre,
        CASE
            WHEN pc.modulo::text = 'compras'::text THEN ( SELECT count(*) AS count
               FROM public.detalle_compras dv
              WHERE dv.periodo_id = pc.id)
            ELSE ( SELECT count(*) AS count
               FROM public.detalle_ventas dv
              WHERE dv.periodo_id = pc.id)
        END AS total_registros,
        CASE
            WHEN pc.modulo::text = 'compras'::text THEN ( SELECT count(*) AS count
               FROM public.detalle_compras dv
              WHERE dv.periodo_id = pc.id AND dv.estado_validacion::text = 'OK'::text)
            ELSE ( SELECT count(*) AS count
               FROM public.detalle_ventas dv
              WHERE dv.periodo_id = pc.id AND dv.estado_validacion::text = 'OK'::text)
        END AS ok_registros,
        CASE
            WHEN pc.modulo::text = 'compras'::text THEN ( SELECT count(*) AS count
               FROM public.detalle_compras dv
              WHERE dv.periodo_id = pc.id AND dv.estado_validacion::text = 'ERROR'::text)
            ELSE ( SELECT count(*) AS count
               FROM public.detalle_ventas dv
              WHERE dv.periodo_id = pc.id AND dv.estado_validacion::text = 'ERROR'::text)
        END AS error_registros,
        CASE
            WHEN pc.modulo::text = 'compras'::text THEN ( SELECT count(*) AS count
               FROM public.detalle_compras dv
              WHERE dv.periodo_id = pc.id AND dv.estado_validacion::text = 'OBSERVADO'::text)
            ELSE ( SELECT count(*) AS count
               FROM public.detalle_ventas dv
              WHERE dv.periodo_id = pc.id AND dv.estado_validacion::text = 'OBSERVADO'::text)
        END AS observado_registros
   FROM public.periodos_carga pc
     JOIN public.empresas e ON pc.empresa_id = e.id
     LEFT JOIN public.usuarios u ON pc.usuario_id = u.id
  ORDER BY pc.fecha_carga DESC, pc.version DESC;
