-- ============================================================================
-- Migración ECC: Seguridad RLS, RPCs Atómicas, Revocación de Sesiones e Índices
-- ============================================================================

-- 1. Eliminar funciones obsoletas sin uso
DROP FUNCTION IF EXISTS public.crear_empresa_y_vincular_admin(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.crear_usuario(TEXT, TEXT, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.get_user_empresa();

-- 2. Proteger estudio_id en UPDATE de empresas
CREATE OR REPLACE FUNCTION public.set_empresa_estudio()
RETURNS TRIGGER AS $$
DECLARE
    v_estudio_id UUID;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.estudio_id IS DISTINCT FROM OLD.estudio_id THEN
        RAISE EXCEPTION 'No está permitido cambiar el estudio contable de una empresa.';
    END IF;
    IF TG_OP = 'INSERT' THEN
        v_estudio_id := public.get_user_estudio();
        IF v_estudio_id IS NOT NULL THEN
            NEW.estudio_id := v_estudio_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS trg_set_empresa_estudio ON public.empresas;
CREATE TRIGGER trg_set_empresa_estudio
    BEFORE INSERT OR UPDATE ON public.empresas
    FOR EACH ROW EXECUTE FUNCTION public.set_empresa_estudio();

-- 3. Endurecer crear_usuario, actualizar_usuario y eliminar_usuario
CREATE OR REPLACE FUNCTION public.crear_usuario(
    p_email TEXT,
    p_password TEXT,
    p_nombre TEXT,
    p_rol TEXT,
    p_empresa_ids UUID[]
) RETURNS UUID AS $$
DECLARE
    v_user_id UUID;
    v_encrypted_pw TEXT;
    v_caller_estudio_id UUID;
    v_emp_id UUID;
    v_clean_email TEXT;
    v_clean_nombre TEXT;
    v_unique_empresas UUID[];
BEGIN
    IF public.get_user_rol() IS DISTINCT FROM 'admin' THEN
        PERFORM public.registrar_evento_seguridad('INTENTO_CREAR_USUARIO_NO_AUTORIZADO', jsonb_build_object('email_objetivo', left(COALESCE(p_email, ''), 120)));
        RAISE EXCEPTION 'Solo administradores activos pueden crear usuarios.';
    END IF;

    v_clean_email := lower(trim(COALESCE(p_email, '')));
    v_clean_nombre := trim(COALESCE(p_nombre, ''));

    IF length(v_clean_nombre) < 2 OR length(v_clean_nombre) > 120 OR v_clean_nombre ~ '[<>]' THEN
        RAISE EXCEPTION 'El nombre del colaborador debe tener entre 2 y 120 caracteres sin etiquetas HTML.';
    END IF;

    IF p_rol NOT IN ('admin', 'operador', 'consulta') THEN
        RAISE EXCEPTION 'Rol inválido.';
    END IF;

    SELECT ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(p_empresa_ids, ARRAY[]::UUID[])) AS x WHERE x IS NOT NULL)
      INTO v_unique_empresas;

    IF array_length(v_unique_empresas, 1) IS NULL OR array_length(v_unique_empresas, 1) = 0 THEN
        RAISE EXCEPTION 'Debes asignar al menos una empresa al colaborador.';
    END IF;

    v_caller_estudio_id := public.get_user_estudio();
    IF v_caller_estudio_id IS NULL THEN
        RAISE EXCEPTION 'Estudio contable no identificado.';
    END IF;

    FOREACH v_emp_id IN ARRAY v_unique_empresas LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.empresas WHERE id = v_emp_id AND estudio_id = v_caller_estudio_id
        ) THEN
            PERFORM public.registrar_evento_seguridad('IDOR_EMPRESA_CREAR_USUARIO', jsonb_build_object('empresa_id', v_emp_id));
            RAISE EXCEPTION 'No tienes permisos para asignar empresas de otro estudio.';
        END IF;
    END LOOP;

    IF length(v_clean_email) > 254 OR v_clean_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
        RAISE EXCEPTION 'Formato de correo electrónico inválido.';
    END IF;
    IF length(p_password) < 8 OR length(p_password) > 128 THEN
        RAISE EXCEPTION 'La contraseña debe tener entre 8 y 128 caracteres.';
    END IF;
    IF p_password !~ '[A-Z]' THEN RAISE EXCEPTION 'La contraseña debe contener al menos una letra mayúscula.'; END IF;
    IF p_password !~ '[a-z]' THEN RAISE EXCEPTION 'La contraseña debe contener al menos una letra minúscula.'; END IF;
    IF p_password !~ '[0-9]' THEN RAISE EXCEPTION 'La contraseña debe contener al menos un número.'; END IF;

    v_user_id := gen_random_uuid();
    v_encrypted_pw := extensions.crypt(p_password, extensions.gen_salt('bf', 12));

    BEGIN
        INSERT INTO auth.users (
            instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
            raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous,
            confirmation_token, recovery_token, email_change_token_new, email_change,
            email_change_token_current, reauthentication_token, phone_change, phone_change_token
        ) VALUES (
            '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
            v_clean_email, v_encrypted_pw, now(),
            jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'rol', p_rol),
            jsonb_build_object('nombre', v_clean_nombre),
            now(), now(), false, false,
            '', '', '', '',
            '', '', '', ''
        );
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'Ya existe un colaborador registrado con ese correo electrónico.';
    END;

    INSERT INTO auth.identities (
        id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) VALUES (
        v_user_id, v_user_id, jsonb_build_object('sub', v_user_id::text, 'email', v_clean_email), 'email', v_user_id::text, now(), now(), now()
    );

    INSERT INTO public.usuarios (id, empresa_id, estudio_id, nombre, rol, activo)
    VALUES (v_user_id, v_unique_empresas[1], v_caller_estudio_id, v_clean_nombre, p_rol, true);

    INSERT INTO public.usuario_empresas (usuario_id, empresa_id)
    SELECT v_user_id, unnest(v_unique_empresas);

    RETURN v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.actualizar_usuario(
    p_id UUID,
    p_nombre TEXT,
    p_rol TEXT,
    p_activo BOOLEAN,
    p_password TEXT DEFAULT NULL,
    p_empresa_ids UUID[] DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
    v_caller_estudio_id UUID;
    v_emp_id UUID;
    v_clean_nombre TEXT;
    v_unique_empresas UUID[];
    v_revoke_sessions BOOLEAN := false;
BEGIN
    IF public.get_user_rol() IS DISTINCT FROM 'admin' THEN
        PERFORM public.registrar_evento_seguridad('INTENTO_ACTUALIZAR_USUARIO_NO_AUTORIZADO', jsonb_build_object('target_id', p_id));
        RAISE EXCEPTION 'Solo administradores activos pueden editar usuarios.';
    END IF;

    v_clean_nombre := trim(COALESCE(p_nombre, ''));
    IF length(v_clean_nombre) < 2 OR length(v_clean_nombre) > 120 OR v_clean_nombre ~ '[<>]' THEN
        RAISE EXCEPTION 'Nombre de colaborador inválido (2-120 caracteres, sin etiquetas HTML).';
    END IF;

    IF p_rol NOT IN ('admin', 'operador', 'consulta') THEN
        RAISE EXCEPTION 'Rol inválido.';
    END IF;

    v_caller_estudio_id := public.get_user_estudio();

    IF NOT EXISTS (
        SELECT 1 FROM public.usuarios
        WHERE id = p_id AND estudio_id = v_caller_estudio_id
    ) THEN
        PERFORM public.registrar_evento_seguridad('IDOR_ACTUALIZAR_USUARIO', jsonb_build_object('target_id', p_id));
        RAISE EXCEPTION 'El usuario objetivo no pertenece a tu estudio contable o no existe.';
    END IF;

    IF p_empresa_ids IS NOT NULL THEN
        SELECT ARRAY(SELECT DISTINCT x FROM unnest(p_empresa_ids) AS x WHERE x IS NOT NULL)
          INTO v_unique_empresas;

        IF array_length(v_unique_empresas, 1) IS NULL OR array_length(v_unique_empresas, 1) = 0 THEN
            RAISE EXCEPTION 'Debes asignar al menos una empresa al colaborador.';
        END IF;

        FOREACH v_emp_id IN ARRAY v_unique_empresas LOOP
            IF NOT EXISTS (
                SELECT 1 FROM public.empresas WHERE id = v_emp_id AND estudio_id = v_caller_estudio_id
            ) THEN
                PERFORM public.registrar_evento_seguridad('IDOR_EMPRESA_ACTUALIZAR_USUARIO', jsonb_build_object('empresa_id', v_emp_id));
                RAISE EXCEPTION 'No tienes permisos para asignar empresas de otro estudio.';
            END IF;
        END LOOP;
    END IF;

    IF p_id = (SELECT auth.uid()) AND (p_rol <> 'admin' OR p_activo = false) THEN
        RAISE EXCEPTION 'No puedes cambiar tu propio rol de administrador ni desactivar tu propio usuario.';
    END IF;

    IF p_password IS NOT NULL AND p_password <> '' THEN
        IF length(p_password) < 8 OR length(p_password) > 128 OR p_password !~ '[A-Z]' OR p_password !~ '[a-z]' OR p_password !~ '[0-9]' THEN
            RAISE EXCEPTION 'Contraseña débil. Requiere min 8 caracteres, mayúscula, minúscula y número.';
        END IF;
        UPDATE auth.users
        SET encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 12)),
            updated_at = now()
        WHERE id = p_id;
        v_revoke_sessions := true;
    END IF;

    IF p_activo = false THEN
        v_revoke_sessions := true;
    END IF;

    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('rol', p_rol),
        updated_at = now()
    WHERE id = p_id;

    IF v_revoke_sessions AND p_id <> (SELECT auth.uid()) THEN
        DELETE FROM auth.refresh_tokens WHERE user_id = p_id::text;
        DELETE FROM auth.sessions WHERE user_id = p_id;
    END IF;

    IF v_unique_empresas IS NOT NULL THEN
        DELETE FROM public.usuario_empresas WHERE usuario_id = p_id;

        INSERT INTO public.usuario_empresas (usuario_id, empresa_id)
        SELECT p_id, unnest(v_unique_empresas);

        UPDATE public.usuarios
        SET nombre = v_clean_nombre,
            rol = p_rol,
            activo = p_activo,
            empresa_id = v_unique_empresas[1]
        WHERE id = p_id;
    ELSE
        UPDATE public.usuarios
        SET nombre = v_clean_nombre,
            rol = p_rol,
            activo = p_activo
        WHERE id = p_id;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.eliminar_usuario(
    p_id UUID
) RETURNS VOID AS $$
DECLARE
    v_caller_estudio_id UUID;
BEGIN
    IF public.get_user_rol() IS DISTINCT FROM 'admin' THEN
        PERFORM public.registrar_evento_seguridad('INTENTO_ELIMINAR_USUARIO_NO_AUTORIZADO', jsonb_build_object('target_id', p_id));
        RAISE EXCEPTION 'Solo administradores activos pueden eliminar usuarios.';
    END IF;

    v_caller_estudio_id := public.get_user_estudio();

    IF NOT EXISTS (
        SELECT 1 FROM public.usuarios
        WHERE id = p_id AND estudio_id = v_caller_estudio_id
    ) THEN
        PERFORM public.registrar_evento_seguridad('IDOR_ELIMINAR_USUARIO', jsonb_build_object('target_id', p_id));
        RAISE EXCEPTION 'El usuario objetivo no pertenece a tu estudio contable o no existe.';
    END IF;

    IF p_id = (SELECT auth.uid()) THEN
        RAISE EXCEPTION 'No puedes eliminar tu propio usuario administrador.';
    END IF;

    PERFORM public.registrar_evento_seguridad('ELIMINAR_USUARIO', jsonb_build_object('target_id', p_id));
    DELETE FROM auth.refresh_tokens WHERE user_id = p_id::text;
    DELETE FROM auth.sessions WHERE user_id = p_id;
    DELETE FROM auth.users WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

-- 4. RPCs masivas de carga convertidas a SECURITY INVOKER + validación periodo↔empresa↔módulo
CREATE OR REPLACE FUNCTION public.insertar_lote_ventas(
    p_periodo_id UUID,
    p_empresa_id UUID,
    p_filas JSONB
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

    INSERT INTO public.detalle_ventas (
        periodo_id, empresa_id, car_sunat, serie, correlativo, fecha_emision, tipo_doc_pago,
        tipo_identidad_sap, nro_identidad_sap, nombre_sap,
        base_sap, igv_sap, exonerado_sap, inafecto_sap, otros_sap, total_sap,
        tipo_identidad_sunat, nro_identidad_sunat, nombre_sunat,
        base_sunat, igv_sunat, exonerado_sunat, inafecto_sunat, otros_sunat, total_sunat,
        mensaje_sire, tipo_pago_sire, op_gratuitas, estado_validacion, errores_json
    )
    SELECT
        p_periodo_id,
        p_empresa_id,
        r.car_sunat,
        r.serie,
        r.correlativo,
        r.fecha_emision,
        r.tipo_doc_pago,
        r.tipo_identidad_sap,
        r.nro_identidad_sap,
        r.nombre_sap,
        COALESCE(r.base_sap, 0),
        COALESCE(r.igv_sap, 0),
        COALESCE(r.exonerado_sap, 0),
        COALESCE(r.inafecto_sap, 0),
        COALESCE(r.otros_sap, 0),
        COALESCE(r.total_sap, 0),
        r.tipo_identidad_sunat,
        r.nro_identidad_sunat,
        r.nombre_sunat,
        COALESCE(r.base_sunat, 0),
        COALESCE(r.igv_sunat, 0),
        COALESCE(r.exonerado_sunat, 0),
        COALESCE(r.inafecto_sunat, 0),
        COALESCE(r.otros_sunat, 0),
        COALESCE(r.total_sunat, 0),
        r.mensaje_sire,
        COALESCE(r.tipo_pago_sire, 'NORMAL'),
        COALESCE(r.op_gratuitas, 0),
        r.estado_validacion,
        COALESCE(r.errores_json, '[]'::jsonb)
    FROM jsonb_populate_recordset(null::public.detalle_ventas, p_filas) AS r;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN v_inserted;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.insertar_lote_compras(
    p_periodo_id UUID,
    p_empresa_id UUID,
    p_filas JSONB
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

    INSERT INTO public.detalle_compras (
        periodo_id, empresa_id, car_sunat, ruc_proveedor, serie, correlativo, fecha_emision, tipo_doc_pago,
        tipo_identidad_sap, nro_identidad_sap, nombre_sap,
        base_sap, igv_sap, exonerado_sap, inafecto_sap, otros_sap, total_sap,
        tipo_identidad_sunat, nro_identidad_sunat, nombre_sunat,
        base_sunat, igv_sunat, exonerado_sunat, inafecto_sunat, otros_sunat, total_sunat,
        mensaje_sire, estado_validacion, errores_json
    )
    SELECT
        p_periodo_id,
        p_empresa_id,
        r.car_sunat,
        r.ruc_proveedor,
        r.serie,
        r.correlativo,
        r.fecha_emision,
        r.tipo_doc_pago,
        r.tipo_identidad_sap,
        r.nro_identidad_sap,
        r.nombre_sap,
        COALESCE(r.base_sap, 0),
        COALESCE(r.igv_sap, 0),
        COALESCE(r.exonerado_sap, 0),
        COALESCE(r.inafecto_sap, 0),
        COALESCE(r.otros_sap, 0),
        COALESCE(r.total_sap, 0),
        r.tipo_identidad_sunat,
        r.nro_identidad_sunat,
        r.nombre_sunat,
        COALESCE(r.base_sunat, 0),
        COALESCE(r.igv_sunat, 0),
        COALESCE(r.exonerado_sunat, 0),
        COALESCE(r.inafecto_sunat, 0),
        COALESCE(r.otros_sunat, 0),
        COALESCE(r.total_sunat, 0),
        r.mensaje_sire,
        r.estado_validacion,
        COALESCE(r.errores_json, '[]'::jsonb)
    FROM jsonb_populate_recordset(null::public.detalle_compras, p_filas) AS r;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN v_inserted;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public;

-- 5. RPCs atómicas para publicación segura de períodos y guardado de locales con series
CREATE OR REPLACE FUNCTION public.finalizar_periodo_carga(
    p_periodo_id UUID,
    p_target_version INTEGER
) RETURNS UUID AS $$
DECLARE
    v_row public.periodos_carga%ROWTYPE;
BEGIN
    IF p_target_version IS NULL OR p_target_version < 1 THEN
        RAISE EXCEPTION 'La versión objetivo debe ser un entero positivo.';
    END IF;

    SELECT * INTO v_row
    FROM public.periodos_carga
    WHERE id = p_periodo_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Período de carga no encontrado.';
    END IF;

    IF NOT public.user_has_empresa_access(v_row.empresa_id) OR public.get_user_rol() NOT IN ('admin', 'operador') THEN
        RAISE EXCEPTION 'No autorizado para finalizar este período de carga.';
    END IF;

    DELETE FROM public.periodos_carga
    WHERE id <> p_periodo_id
      AND empresa_id = v_row.empresa_id
      AND periodo = v_row.periodo
      AND dia IS NOT DISTINCT FROM v_row.dia
      AND version = p_target_version
      AND modulo = v_row.modulo;

    UPDATE public.periodos_carga
    SET version = p_target_version,
        estado = 'completado'
    WHERE id = p_periodo_id;

    RETURN p_periodo_id;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.guardar_local_con_series(
    p_local_id UUID,
    p_empresa_id UUID,
    p_nombre TEXT,
    p_activo BOOLEAN,
    p_series JSONB
) RETURNS UUID AS $$
DECLARE
    v_local_id UUID;
    v_clean_nombre TEXT;
BEGIN
    IF public.get_user_rol() IS DISTINCT FROM 'admin' OR NOT public.user_has_empresa_access(p_empresa_id) THEN
        RAISE EXCEPTION 'Solo administradores activos con acceso a la empresa pueden gestionar locales.';
    END IF;

    v_clean_nombre := trim(COALESCE(p_nombre, ''));
    IF length(v_clean_nombre) < 2 OR length(v_clean_nombre) > 120 THEN
        RAISE EXCEPTION 'El nombre del local debe tener entre 2 y 120 caracteres.';
    END IF;

    IF p_series IS NULL OR jsonb_typeof(p_series) <> 'array' OR jsonb_array_length(p_series) = 0 THEN
        RAISE EXCEPTION 'Debes asignar al menos una serie al local.';
    END IF;

    IF p_local_id IS NOT NULL THEN
        UPDATE public.locales_empresa
        SET nombre = v_clean_nombre,
            activo = COALESCE(p_activo, true),
            updated_at = now()
        WHERE id = p_local_id
          AND empresa_id = p_empresa_id
        RETURNING id INTO v_local_id;

        IF v_local_id IS NULL THEN
            RAISE EXCEPTION 'Local no encontrado o no pertenece a la empresa indicada.';
        END IF;

        DELETE FROM public.local_series WHERE local_id = v_local_id;
    ELSE
        INSERT INTO public.locales_empresa (empresa_id, nombre, activo)
        VALUES (p_empresa_id, v_clean_nombre, COALESCE(p_activo, true))
        RETURNING id INTO v_local_id;
    END IF;

    INSERT INTO public.local_series (local_id, empresa_id, tipo_doc_pago, serie)
    SELECT DISTINCT
        v_local_id,
        p_empresa_id,
        trim(elem->>'tipo_doc_pago'),
        upper(trim(elem->>'serie'))
    FROM jsonb_array_elements(p_series) AS elem;

    RETURN v_local_id;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public;

-- 6. Revocar EXECUTE de PUBLIC y anon en todas las funciones de negocio
REVOKE ALL ON FUNCTION public.insertar_lote_ventas(UUID, UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.insertar_lote_compras(UUID, UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalizar_periodo_carga(UUID, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guardar_local_con_series(UUID, UUID, TEXT, BOOLEAN, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crear_usuario(TEXT, TEXT, TEXT, TEXT, UUID[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.actualizar_usuario(UUID, TEXT, TEXT, BOOLEAN, TEXT, UUID[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.eliminar_usuario(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.insertar_lote_ventas(UUID, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insertar_lote_compras(UUID, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalizar_periodo_carga(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_local_con_series(UUID, UUID, TEXT, BOOLEAN, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crear_usuario(TEXT, TEXT, TEXT, TEXT, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.actualizar_usuario(UUID, TEXT, TEXT, BOOLEAN, TEXT, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_usuario(UUID) TO authenticated;

-- 7. Refactorizar políticas RLS (eliminar superposición FOR ALL + FOR SELECT)
DROP POLICY IF EXISTS all_empresas_admin ON public.empresas;
CREATE POLICY insert_empresas_admin ON public.empresas
    FOR INSERT TO authenticated
    WITH CHECK (estudio_id = (SELECT public.get_user_estudio()) AND (SELECT public.get_user_rol()) = 'admin');
CREATE POLICY update_empresas_admin ON public.empresas
    FOR UPDATE TO authenticated
    USING (estudio_id = (SELECT public.get_user_estudio()) AND (SELECT public.get_user_rol()) = 'admin')
    WITH CHECK (estudio_id = (SELECT public.get_user_estudio()) AND (SELECT public.get_user_rol()) = 'admin');
CREATE POLICY delete_empresas_admin ON public.empresas
    FOR DELETE TO authenticated
    USING (estudio_id = (SELECT public.get_user_estudio()) AND (SELECT public.get_user_rol()) = 'admin');

DROP POLICY IF EXISTS select_usuarios ON public.usuarios;
DROP POLICY IF EXISTS all_usuarios_admin ON public.usuarios;
CREATE POLICY select_usuarios ON public.usuarios
    FOR SELECT TO authenticated
    USING (
        id = (SELECT auth.uid())
        OR (estudio_id = (SELECT public.get_user_estudio()) AND (SELECT public.get_user_rol()) = 'admin')
    );
CREATE POLICY insert_usuarios_admin ON public.usuarios
    FOR INSERT TO authenticated
    WITH CHECK (estudio_id = (SELECT public.get_user_estudio()) AND (SELECT public.get_user_rol()) = 'admin');
CREATE POLICY update_usuarios_admin ON public.usuarios
    FOR UPDATE TO authenticated
    USING (estudio_id = (SELECT public.get_user_estudio()) AND (SELECT public.get_user_rol()) = 'admin')
    WITH CHECK (estudio_id = (SELECT public.get_user_estudio()) AND (SELECT public.get_user_rol()) = 'admin');
CREATE POLICY delete_usuarios_admin ON public.usuarios
    FOR DELETE TO authenticated
    USING (estudio_id = (SELECT public.get_user_estudio()) AND (SELECT public.get_user_rol()) = 'admin');

DROP POLICY IF EXISTS all_usuario_empresas_admin ON public.usuario_empresas;
CREATE POLICY insert_usuario_empresas_admin ON public.usuario_empresas
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.get_user_rol()) = 'admin' AND empresa_id IN (SELECT id FROM public.empresas WHERE estudio_id = (SELECT public.get_user_estudio())));
CREATE POLICY update_usuario_empresas_admin ON public.usuario_empresas
    FOR UPDATE TO authenticated
    USING ((SELECT public.get_user_rol()) = 'admin' AND empresa_id IN (SELECT id FROM public.empresas WHERE estudio_id = (SELECT public.get_user_estudio())))
    WITH CHECK ((SELECT public.get_user_rol()) = 'admin' AND empresa_id IN (SELECT id FROM public.empresas WHERE estudio_id = (SELECT public.get_user_estudio())));
CREATE POLICY delete_usuario_empresas_admin ON public.usuario_empresas
    FOR DELETE TO authenticated
    USING ((SELECT public.get_user_rol()) = 'admin' AND empresa_id IN (SELECT id FROM public.empresas WHERE estudio_id = (SELECT public.get_user_estudio())));

DROP POLICY IF EXISTS all_periodos_ops ON public.periodos_carga;
CREATE POLICY insert_periodos_ops ON public.periodos_carga
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.user_has_empresa_access(empresa_id)) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));
CREATE POLICY update_periodos_ops ON public.periodos_carga
    FOR UPDATE TO authenticated
    USING ((SELECT public.user_has_empresa_access(empresa_id)) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'))
    WITH CHECK ((SELECT public.user_has_empresa_access(empresa_id)) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));
CREATE POLICY delete_periodos_ops ON public.periodos_carga
    FOR DELETE TO authenticated
    USING ((SELECT public.user_has_empresa_access(empresa_id)) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));

DROP POLICY IF EXISTS all_detalle_ventas_ops ON public.detalle_ventas;
CREATE POLICY insert_detalle_ventas_ops ON public.detalle_ventas
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.user_has_empresa_access(empresa_id)) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));
CREATE POLICY update_detalle_ventas_ops ON public.detalle_ventas
    FOR UPDATE TO authenticated
    USING ((SELECT public.user_has_empresa_access(empresa_id)) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'))
    WITH CHECK ((SELECT public.user_has_empresa_access(empresa_id)) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));
CREATE POLICY delete_detalle_ventas_ops ON public.detalle_ventas
    FOR DELETE TO authenticated
    USING ((SELECT public.user_has_empresa_access(empresa_id)) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));

DROP POLICY IF EXISTS all_detalle_compras_ops ON public.detalle_compras;
CREATE POLICY insert_detalle_compras_ops ON public.detalle_compras
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.user_has_empresa_access(empresa_id)) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));
CREATE POLICY update_detalle_compras_ops ON public.detalle_compras
    FOR UPDATE TO authenticated
    USING ((SELECT public.user_has_empresa_access(empresa_id)) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'))
    WITH CHECK ((SELECT public.user_has_empresa_access(empresa_id)) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));
CREATE POLICY delete_detalle_compras_ops ON public.detalle_compras
    FOR DELETE TO authenticated
    USING ((SELECT public.user_has_empresa_access(empresa_id)) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));

DROP POLICY IF EXISTS all_locales_empresa_admin ON public.locales_empresa;
CREATE POLICY insert_locales_empresa_admin ON public.locales_empresa
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.user_has_empresa_access(empresa_id)) AND (SELECT public.get_user_rol()) = 'admin');
CREATE POLICY update_locales_empresa_admin ON public.locales_empresa
    FOR UPDATE TO authenticated
    USING ((SELECT public.user_has_empresa_access(empresa_id)) AND (SELECT public.get_user_rol()) = 'admin')
    WITH CHECK ((SELECT public.user_has_empresa_access(empresa_id)) AND (SELECT public.get_user_rol()) = 'admin');
CREATE POLICY delete_locales_empresa_admin ON public.locales_empresa
    FOR DELETE TO authenticated
    USING ((SELECT public.user_has_empresa_access(empresa_id)) AND (SELECT public.get_user_rol()) = 'admin');

DROP POLICY IF EXISTS all_local_series_admin ON public.local_series;
CREATE POLICY insert_local_series_admin ON public.local_series
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.user_has_empresa_access(empresa_id)) AND (SELECT public.get_user_rol()) = 'admin');
CREATE POLICY update_local_series_admin ON public.local_series
    FOR UPDATE TO authenticated
    USING ((SELECT public.user_has_empresa_access(empresa_id)) AND (SELECT public.get_user_rol()) = 'admin')
    WITH CHECK ((SELECT public.user_has_empresa_access(empresa_id)) AND (SELECT public.get_user_rol()) = 'admin');
CREATE POLICY delete_local_series_admin ON public.local_series
    FOR DELETE TO authenticated
    USING ((SELECT public.user_has_empresa_access(empresa_id)) AND (SELECT public.get_user_rol()) = 'admin');

-- 8. Optimización de índices
DROP INDEX IF EXISTS public.idx_detalle_ventas_periodo_id;
DROP INDEX IF EXISTS public.idx_detalle_compras_periodo_id;
DROP INDEX IF EXISTS public.idx_detalle_ventas_errores_json_gin;
DROP INDEX IF EXISTS public.idx_detalle_compras_errores_json_gin;
DROP INDEX IF EXISTS public.idx_detalle_ventas_buscar_documento_trgm;
DROP INDEX IF EXISTS public.idx_detalle_compras_buscar_documento_trgm;
DROP INDEX IF EXISTS public.idx_detalle_ventas_correlativo_int;
DROP INDEX IF EXISTS public.idx_detalle_compras_correlativo_int;
DROP INDEX IF EXISTS public.idx_detalle_ventas_car_sunat;
DROP INDEX IF EXISTS public.idx_detalle_compras_car_sunat;
DROP INDEX IF EXISTS public.idx_detalle_ventas_periodo_orden;
DROP INDEX IF EXISTS public.idx_detalle_compras_periodo_orden;
DROP INDEX IF EXISTS public.idx_auditoria_estudio_id;

CREATE INDEX IF NOT EXISTS idx_detalle_ventas_periodo_orden_id
    ON public.detalle_ventas (periodo_id, fecha_emision, serie, correlativo, id);
CREATE INDEX IF NOT EXISTS idx_detalle_compras_periodo_orden_id
    ON public.detalle_compras (periodo_id, fecha_emision, serie, correlativo, id);
CREATE INDEX IF NOT EXISTS idx_auditoria_estudio_fecha
    ON public.auditoria (estudio_id, fecha_hora DESC);

-- 9. Alinear vistas SQL con motores v2
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
    sum(total_sap) - sum(total_sunat) AS diff_total,
    count(*) FILTER (WHERE nro_identidad_sap IS NOT NULL OR nombre_sap IS NOT NULL) AS total_sap,
    count(*) FILTER (WHERE nro_identidad_sunat IS NOT NULL OR nombre_sunat IS NOT NULL) AS total_sunat,
    count(*) FILTER (
      WHERE (nro_identidad_sap IS NOT NULL OR nombre_sap IS NOT NULL)
        AND (nro_identidad_sunat IS NOT NULL OR nombre_sunat IS NOT NULL)
    ) AS coincidentes_registros,
    count(*) FILTER (
      WHERE (nro_identidad_sap IS NOT NULL OR nombre_sap IS NOT NULL)
        AND nro_identidad_sunat IS NULL AND nombre_sunat IS NULL
    ) AS solo_sap_registros,
    count(*) FILTER (
      WHERE (nro_identidad_sunat IS NOT NULL OR nombre_sunat IS NOT NULL)
        AND nro_identidad_sap IS NULL AND nombre_sap IS NULL
    ) AS solo_sunat_registros,
    count(*) FILTER (
      WHERE (nro_identidad_sap IS NOT NULL OR nombre_sap IS NOT NULL)
        AND (nro_identidad_sunat IS NOT NULL OR nombre_sunat IS NOT NULL)
        AND upper(COALESCE(nombre_sap, '')) <> 'ANULADO'
        AND (
          abs(COALESCE(base_sap, 0) - COALESCE(base_sunat, 0)) > 0.05
          OR abs(COALESCE(igv_sap, 0) - COALESCE(igv_sunat, 0)) > 0.05
          OR abs(COALESCE(exonerado_sap, 0) - COALESCE(exonerado_sunat, 0)) > 0.05
          OR abs(COALESCE(inafecto_sap, 0) - COALESCE(inafecto_sunat, 0)) > 0.05
          OR abs(COALESCE(otros_sap, 0) - COALESCE(otros_sunat, 0)) > 0.05
          OR abs(COALESCE(total_sap, 0) - COALESCE(total_sunat, 0)) > 0.05
        )
    ) AS dif_importes_registros,
    count(*) FILTER (
      WHERE (nro_identidad_sap IS NOT NULL OR nombre_sap IS NOT NULL)
        AND (nro_identidad_sunat IS NOT NULL OR nombre_sunat IS NOT NULL)
        AND upper(COALESCE(nombre_sap, '')) <> 'ANULADO'
        AND (
          COALESCE(tipo_identidad_sap, '') <> COALESCE(tipo_identidad_sunat, '')
          OR COALESCE(nro_identidad_sap, '') <> COALESCE(nro_identidad_sunat, '')
        )
    ) AS prob_identidad_registros
   FROM public.detalle_ventas
  GROUP BY periodo_id;

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
    sum(total_sap) - sum(total_sunat) AS diff_total,
    count(*) FILTER (WHERE nro_identidad_sap IS NOT NULL OR nombre_sap IS NOT NULL) AS total_sap,
    count(*) FILTER (WHERE nro_identidad_sunat IS NOT NULL OR nombre_sunat IS NOT NULL) AS total_sunat,
    count(*) FILTER (
      WHERE (nro_identidad_sap IS NOT NULL OR nombre_sap IS NOT NULL)
        AND (nro_identidad_sunat IS NOT NULL OR nombre_sunat IS NOT NULL)
    ) AS coincidentes_registros,
    count(*) FILTER (
      WHERE (nro_identidad_sap IS NOT NULL OR nombre_sap IS NOT NULL)
        AND nro_identidad_sunat IS NULL AND nombre_sunat IS NULL
    ) AS solo_sap_registros,
    count(*) FILTER (
      WHERE (nro_identidad_sunat IS NOT NULL OR nombre_sunat IS NOT NULL)
        AND nro_identidad_sap IS NULL AND nombre_sap IS NULL
    ) AS solo_sunat_registros
   FROM public.detalle_compras
  GROUP BY periodo_id;
