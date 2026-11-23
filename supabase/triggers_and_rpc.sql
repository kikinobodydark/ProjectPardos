-- ==========================================
-- 1. HELPER FUNCTIONS CON search_path FIJO Y VALIDACIÓN DE USUARIO ACTIVO
-- ==========================================
CREATE OR REPLACE FUNCTION public.get_user_estudio()
RETURNS UUID AS $$
    SELECT estudio_id FROM public.usuarios WHERE id = (SELECT auth.uid()) AND activo = true;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.get_user_rol()
RETURNS TEXT AS $$
    SELECT rol FROM public.usuarios WHERE id = (SELECT auth.uid()) AND activo = true;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public;

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

CREATE OR REPLACE FUNCTION public.user_has_empresa_access(p_empresa_id UUID)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.usuarios u
        WHERE u.id = (SELECT auth.uid())
          AND u.activo = true
          AND (
              (u.rol = 'admin' AND EXISTS (
                  SELECT 1 FROM public.empresas e WHERE e.id = p_empresa_id AND e.estudio_id = u.estudio_id
              ))
              OR EXISTS (
                  SELECT 1 FROM public.usuario_empresas ue
                  JOIN public.empresas e ON e.id = ue.empresa_id
                  WHERE ue.usuario_id = u.id AND ue.empresa_id = p_empresa_id AND e.estudio_id = u.estudio_id
              )
          )
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public;

-- ==========================================
-- 2. TRIGGER DE ASIGNACIÓN AUTOMÁTICA DE ESTUDIO EN EMPRESAS (Hardened)
-- ==========================================
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

-- ==========================================
-- 3. TRIGGER DE AUDITORÍA Y REGISTRO DE EVENTOS DE SEGURIDAD
-- ==========================================
CREATE OR REPLACE FUNCTION public.audit_trigger_func()
RETURNS TRIGGER AS $$
DECLARE
    v_user_id UUID;
    v_estudio_id UUID;
    v_empresa_id UUID;
    v_old_data JSONB := null;
    v_new_data JSONB := null;
BEGIN
    -- Omitir auditoría fila por fila en tablas masivas de detalle (se audita la cabecera en periodos_carga)
    IF TG_TABLE_NAME IN ('detalle_ventas', 'detalle_compras') THEN
        IF (TG_OP = 'DELETE') THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    BEGIN v_user_id := (SELECT auth.uid()); EXCEPTION WHEN OTHERS THEN v_user_id := null; END;

    SELECT estudio_id INTO v_estudio_id FROM public.usuarios WHERE id = v_user_id;

    IF (TG_OP = 'DELETE') THEN
        v_old_data := to_jsonb(OLD);
        IF TG_TABLE_NAME = 'empresas' THEN v_empresa_id := OLD.id;
        ELSE BEGIN v_empresa_id := OLD.empresa_id; EXCEPTION WHEN OTHERS THEN v_empresa_id := null; END; END IF;
    ELSIF (TG_OP = 'UPDATE') THEN
        v_old_data := to_jsonb(OLD); v_new_data := to_jsonb(NEW);
        IF TG_TABLE_NAME = 'empresas' THEN v_empresa_id := NEW.id;
        ELSE BEGIN v_empresa_id := OLD.empresa_id; EXCEPTION WHEN OTHERS THEN v_empresa_id := null; END; END IF;
    ELSIF (TG_OP = 'INSERT') THEN
        v_new_data := to_jsonb(NEW);
        IF TG_TABLE_NAME = 'empresas' THEN v_empresa_id := NEW.id;
        ELSE BEGIN v_empresa_id := NEW.empresa_id; EXCEPTION WHEN OTHERS THEN v_empresa_id := null; END; END IF;
    END IF;

    INSERT INTO public.auditoria (
        tabla_afectada, operacion, usuario_id, empresa_id, estudio_id, datos_anteriores, datos_nuevos, fecha_hora
    ) VALUES (
        TG_TABLE_NAME, TG_OP, v_user_id, v_empresa_id, v_estudio_id, v_old_data, v_new_data, now()
    );

    IF (TG_OP = 'DELETE') THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS audit_empresas ON public.empresas;
CREATE TRIGGER audit_empresas AFTER INSERT OR UPDATE OR DELETE ON public.empresas
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS audit_usuarios ON public.usuarios;
CREATE TRIGGER audit_usuarios AFTER INSERT OR UPDATE OR DELETE ON public.usuarios
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS audit_periodos ON public.periodos_carga;
CREATE TRIGGER audit_periodos AFTER INSERT OR UPDATE OR DELETE ON public.periodos_carga
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS audit_locales_empresa ON public.locales_empresa;
CREATE TRIGGER audit_locales_empresa AFTER INSERT OR UPDATE OR DELETE ON public.locales_empresa
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS audit_local_series ON public.local_series;
CREATE TRIGGER audit_local_series AFTER INSERT OR UPDATE OR DELETE ON public.local_series
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

CREATE OR REPLACE FUNCTION public.registrar_evento_seguridad(
    p_evento TEXT,
    p_detalle JSONB DEFAULT '{}'::jsonb
) RETURNS VOID AS $$
DECLARE
    v_user_id UUID;
    v_estudio_id UUID;
    v_empresa_id UUID;
BEGIN
    v_user_id := (SELECT auth.uid());
    IF v_user_id IS NOT NULL THEN
        SELECT estudio_id, empresa_id INTO v_estudio_id, v_empresa_id
        FROM public.usuarios WHERE id = v_user_id;
    END IF;

    IF p_evento IS NULL OR length(trim(p_evento)) = 0 OR length(p_evento) > 120 THEN
        RAISE EXCEPTION 'Identificador de evento inválido.';
    END IF;
    IF pg_column_size(p_detalle) > 4096 THEN
        RAISE EXCEPTION 'Detalle de evento excede el tamaño máximo permitido.';
    END IF;

    INSERT INTO public.auditoria (
        tabla_afectada, operacion, usuario_id, empresa_id, estudio_id, datos_anteriores, datos_nuevos, fecha_hora
    ) VALUES (
        'SEGURIDAD:' || left(trim(p_evento), 100),
        'INSERT',
        v_user_id,
        v_empresa_id,
        v_estudio_id,
        NULL,
        jsonb_build_object(
            'evento', left(trim(p_evento), 100),
            'detalle', COALESCE(p_detalle, '{}'::jsonb),
            'rol_db', current_user,
            'timestamp_utc', now()
        ),
        now()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

-- ==========================================
-- 4. BOOTSTRAP RPC CON VALIDACIONES COMPLETAS
-- ==========================================
CREATE OR REPLACE FUNCTION public.crear_estudio_empresa_y_admin(
    p_nombre_estudio TEXT,
    p_ruc TEXT,
    p_razon_social TEXT,
    p_nombre_admin TEXT
) RETURNS UUID AS $$
DECLARE
    v_estudio_id UUID;
    v_empresa_id UUID;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado.'; END IF;
    IF EXISTS (SELECT 1 FROM public.estudios) THEN
        RAISE EXCEPTION 'El auto-registro está deshabilitado en este entorno.';
    END IF;

    IF trim(p_nombre_estudio) = '' THEN RAISE EXCEPTION 'El nombre del estudio contable está vacío.'; END IF;
    IF length(p_ruc) <> 11 OR p_ruc !~ '^\d+$' THEN RAISE EXCEPTION 'El RUC debe tener exactamente 11 dígitos.'; END IF;
    IF trim(p_razon_social) = '' THEN RAISE EXCEPTION 'La razón social está vacía.'; END IF;
    IF trim(p_nombre_admin) = '' THEN RAISE EXCEPTION 'El nombre del administrador está vacío.'; END IF;
    
    INSERT INTO public.estudios (nombre) VALUES (p_nombre_estudio) RETURNING id INTO v_estudio_id;
    INSERT INTO public.empresas (ruc, razon_social, estudio_id, activo) VALUES (p_ruc, p_razon_social, v_estudio_id, true) RETURNING id INTO v_empresa_id;
    INSERT INTO public.usuarios (id, empresa_id, estudio_id, nombre, rol, activo) VALUES ((SELECT auth.uid()), v_empresa_id, v_estudio_id, p_nombre_admin, 'admin', true);
    INSERT INTO public.usuario_empresas (usuario_id, empresa_id) VALUES ((SELECT auth.uid()), v_empresa_id);
    
    RETURN v_estudio_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

-- ==========================================
-- 5. RPCS PARA GESTIÓN DE USUARIOS (Endurecidas con bcrypt cost 12, revocación de sesiones y auditoría)
-- ==========================================
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

    INSERT INTO public.usuarios (id, empresa_id, estudio_id, nombre, email, rol, activo)
    VALUES (v_user_id, v_unique_empresas[1], v_caller_estudio_id, v_clean_nombre, v_clean_email, p_rol, true);

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

CREATE OR REPLACE FUNCTION public.actualizar_correo_usuario(
    p_id UUID,
    p_email TEXT
) RETURNS VOID AS $$
DECLARE
    v_caller_estudio_id UUID;
    v_clean_email TEXT;
    v_current_email TEXT;
BEGIN
    IF public.get_user_rol() IS DISTINCT FROM 'admin' THEN
        PERFORM public.registrar_evento_seguridad('INTENTO_ACTUALIZAR_CORREO_NO_AUTORIZADO', jsonb_build_object('target_id', p_id));
        RAISE EXCEPTION 'Solo administradores activos pueden editar correos de usuarios.';
    END IF;

    v_caller_estudio_id := public.get_user_estudio();

    IF NOT EXISTS (
        SELECT 1 FROM public.usuarios
        WHERE id = p_id AND estudio_id = v_caller_estudio_id
    ) THEN
        PERFORM public.registrar_evento_seguridad('IDOR_ACTUALIZAR_CORREO_USUARIO', jsonb_build_object('target_id', p_id));
        RAISE EXCEPTION 'El usuario objetivo no pertenece a tu estudio contable o no existe.';
    END IF;

    v_clean_email := lower(trim(COALESCE(p_email, '')));
    IF length(v_clean_email) > 254 OR v_clean_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
        RAISE EXCEPTION 'Formato de correo electrónico inválido.';
    END IF;

    SELECT lower(email) INTO v_current_email FROM auth.users WHERE id = p_id;

    IF v_clean_email IS DISTINCT FROM v_current_email THEN
        BEGIN
            UPDATE auth.users
            SET email = v_clean_email,
                email_confirmed_at = COALESCE(email_confirmed_at, now()),
                updated_at = now()
            WHERE id = p_id;
        EXCEPTION WHEN unique_violation THEN
            RAISE EXCEPTION 'Ya existe un colaborador registrado con ese correo electrónico.';
        END;

        UPDATE auth.identities
        SET identity_data = COALESCE(identity_data, '{}'::jsonb) || jsonb_build_object('email', v_clean_email),
            updated_at = now()
        WHERE user_id = p_id AND provider = 'email';

        IF p_id <> (SELECT auth.uid()) THEN
            UPDATE auth.refresh_tokens
            SET revoked = true, updated_at = now()
            WHERE user_id = p_id::text AND revoked = false;
        END IF;

        PERFORM public.registrar_evento_seguridad(
            'ACTUALIZAR_CORREO_USUARIO',
            jsonb_build_object('target_id', p_id, 'email_anterior', v_current_email, 'email_nuevo', v_clean_email)
        );
    END IF;

    UPDATE public.usuarios
    SET email = v_clean_email
    WHERE id = p_id;
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

-- ==========================================
-- 5.1 RPCS ATÓMICAS DE CARGA MASIVA Y LOCALES (SECURITY INVOKER)
-- ==========================================
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
    FROM jsonb_populate_recordset(null::public.detalle_ventas, p_filas) AS r;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN v_inserted;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public SET statement_timeout = '30s';

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
        p_periodo_id, p_empresa_id,
        r.car_sunat, r.ruc_proveedor, r.serie, r.correlativo, r.fecha_emision, r.tipo_doc_pago,
        r.tipo_identidad_sap, r.nro_identidad_sap, r.nombre_sap,
        COALESCE(r.base_sap, 0), COALESCE(r.igv_sap, 0), COALESCE(r.exonerado_sap, 0),
        COALESCE(r.inafecto_sap, 0), COALESCE(r.otros_sap, 0), COALESCE(r.total_sap, 0),
        r.tipo_identidad_sunat, r.nro_identidad_sunat, r.nombre_sunat,
        COALESCE(r.base_sunat, 0), COALESCE(r.igv_sunat, 0), COALESCE(r.exonerado_sunat, 0),
        COALESCE(r.inafecto_sunat, 0), COALESCE(r.otros_sunat, 0), COALESCE(r.total_sunat, 0),
        r.mensaje_sire, r.estado_validacion, COALESCE(r.errores_json, '[]'::jsonb)
    FROM jsonb_populate_recordset(null::public.detalle_compras, p_filas) AS r;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN v_inserted;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public SET statement_timeout = '30s';

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
        SET nombre = v_clean_nombre, activo = COALESCE(p_activo, true), updated_at = now()
        WHERE id = p_local_id AND empresa_id = p_empresa_id
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
    SELECT DISTINCT v_local_id, p_empresa_id, trim(elem->>'tipo_doc_pago'), upper(trim(elem->>'serie'))
    FROM jsonb_array_elements(p_series) AS elem;

    RETURN v_local_id;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public;

-- ==========================================
-- 6. PERMISOS DE EJECUCIÓN (REVOKE DE PUBLIC Y ANON)
-- ==========================================
REVOKE EXECUTE ON FUNCTION public.get_user_estudio() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_rol() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_has_empresa_access(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_empresa_estudio() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_trigger_func() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.crear_estudio_empresa_y_admin(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.crear_usuario(TEXT, TEXT, TEXT, TEXT, UUID[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.actualizar_usuario(UUID, TEXT, TEXT, BOOLEAN, TEXT, UUID[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.actualizar_correo_usuario(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.eliminar_usuario(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.registrar_evento_seguridad(TEXT, JSONB) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.insertar_lote_ventas(UUID, UUID, JSONB) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.insertar_lote_compras(UUID, UUID, JSONB) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.finalizar_periodo_carga(UUID, INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.obtener_lote_ventas_keyset(UUID, UUID, UUID, UUID, INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.obtener_lote_compras_keyset(UUID, UUID, UUID, UUID, INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.guardar_local_con_series(UUID, UUID, TEXT, BOOLEAN, JSONB) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_user_estudio() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_rol() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_empresa_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crear_estudio_empresa_y_admin(TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crear_usuario(TEXT, TEXT, TEXT, TEXT, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.actualizar_usuario(UUID, TEXT, TEXT, BOOLEAN, TEXT, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.actualizar_correo_usuario(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_usuario(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_evento_seguridad(TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insertar_lote_ventas(UUID, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insertar_lote_compras(UUID, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalizar_periodo_carga(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_lote_ventas_keyset(UUID, UUID, UUID, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_lote_compras_keyset(UUID, UUID, UUID, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_local_con_series(UUID, UUID, TEXT, BOOLEAN, JSONB) TO authenticated;

-- ==========================================
-- 7. HABILITAR RLS Y DEFINIR POLÍTICAS (Sin solapamiento SELECT/ALL)
-- ==========================================
ALTER TABLE public.estudios          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empresas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuario_empresas  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.periodos_carga    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detalle_ventas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detalle_compras   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locales_empresa   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_series      ENABLE ROW LEVEL SECURITY;

-- A. Tabla ESTUDIOS
DROP POLICY IF EXISTS select_estudio ON public.estudios;
CREATE POLICY select_estudio ON public.estudios 
    FOR SELECT TO authenticated
    USING (id = (SELECT public.get_user_estudio()));

-- B. Tabla EMPRESAS
DROP POLICY IF EXISTS select_empresas ON public.empresas;
DROP POLICY IF EXISTS all_empresas_admin ON public.empresas;
DROP POLICY IF EXISTS insert_empresas_admin ON public.empresas;
DROP POLICY IF EXISTS update_empresas_admin ON public.empresas;
DROP POLICY IF EXISTS delete_empresas_admin ON public.empresas;
CREATE POLICY select_empresas ON public.empresas 
    FOR SELECT TO authenticated
    USING (
        estudio_id = (SELECT public.get_user_estudio())
        AND (
            (SELECT public.get_user_rol()) = 'admin'
            OR id = ANY((SELECT private.get_user_empresa_ids())::uuid[])
        )
    );
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

-- C. Tabla USUARIOS
DROP POLICY IF EXISTS select_usuarios ON public.usuarios;
DROP POLICY IF EXISTS all_usuarios_admin ON public.usuarios;
DROP POLICY IF EXISTS insert_usuarios_admin ON public.usuarios;
DROP POLICY IF EXISTS update_usuarios_admin ON public.usuarios;
DROP POLICY IF EXISTS delete_usuarios_admin ON public.usuarios;
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

-- D. Tabla USUARIO_EMPRESAS
DROP POLICY IF EXISTS select_usuario_empresas ON public.usuario_empresas;
DROP POLICY IF EXISTS all_usuario_empresas_admin ON public.usuario_empresas;
DROP POLICY IF EXISTS insert_usuario_empresas_admin ON public.usuario_empresas;
DROP POLICY IF EXISTS update_usuario_empresas_admin ON public.usuario_empresas;
DROP POLICY IF EXISTS delete_usuario_empresas_admin ON public.usuario_empresas;
CREATE POLICY select_usuario_empresas ON public.usuario_empresas
    FOR SELECT TO authenticated
    USING (
        usuario_id = (SELECT auth.uid())
        OR (
            (SELECT public.get_user_rol()) = 'admin'
            AND empresa_id IN (SELECT id FROM public.empresas WHERE estudio_id = (SELECT public.get_user_estudio()))
        )
    );
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

-- E. Tabla PERIODOS DE CARGA
DROP POLICY IF EXISTS select_periodos ON public.periodos_carga;
DROP POLICY IF EXISTS all_periodos_ops ON public.periodos_carga;
DROP POLICY IF EXISTS insert_periodos_ops ON public.periodos_carga;
DROP POLICY IF EXISTS update_periodos_ops ON public.periodos_carga;
DROP POLICY IF EXISTS delete_periodos_ops ON public.periodos_carga;
CREATE POLICY select_periodos ON public.periodos_carga 
    FOR SELECT TO authenticated
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]));
CREATE POLICY insert_periodos_ops ON public.periodos_carga 
    FOR INSERT TO authenticated
    WITH CHECK (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));
CREATE POLICY update_periodos_ops ON public.periodos_carga 
    FOR UPDATE TO authenticated
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'))
    WITH CHECK (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));
CREATE POLICY delete_periodos_ops ON public.periodos_carga 
    FOR DELETE TO authenticated
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));

-- F. Tabla DETALLE DE VENTAS
DROP POLICY IF EXISTS select_detalle_ventas ON public.detalle_ventas;
DROP POLICY IF EXISTS all_detalle_ventas_ops ON public.detalle_ventas;
DROP POLICY IF EXISTS insert_detalle_ventas_ops ON public.detalle_ventas;
DROP POLICY IF EXISTS update_detalle_ventas_ops ON public.detalle_ventas;
DROP POLICY IF EXISTS delete_detalle_ventas_ops ON public.detalle_ventas;
CREATE POLICY select_detalle_ventas ON public.detalle_ventas 
    FOR SELECT TO authenticated
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]));
CREATE POLICY insert_detalle_ventas_ops ON public.detalle_ventas 
    FOR INSERT TO authenticated
    WITH CHECK (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));
CREATE POLICY update_detalle_ventas_ops ON public.detalle_ventas 
    FOR UPDATE TO authenticated
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'))
    WITH CHECK (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));
CREATE POLICY delete_detalle_ventas_ops ON public.detalle_ventas 
    FOR DELETE TO authenticated
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));

-- G. Tabla DETALLE DE COMPRAS
DROP POLICY IF EXISTS select_detalle_compras ON public.detalle_compras;
DROP POLICY IF EXISTS all_detalle_compras_ops ON public.detalle_compras;
DROP POLICY IF EXISTS insert_detalle_compras_ops ON public.detalle_compras;
DROP POLICY IF EXISTS update_detalle_compras_ops ON public.detalle_compras;
DROP POLICY IF EXISTS delete_detalle_compras_ops ON public.detalle_compras;
CREATE POLICY select_detalle_compras ON public.detalle_compras 
    FOR SELECT TO authenticated
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]));
CREATE POLICY insert_detalle_compras_ops ON public.detalle_compras 
    FOR INSERT TO authenticated
    WITH CHECK (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));
CREATE POLICY update_detalle_compras_ops ON public.detalle_compras 
    FOR UPDATE TO authenticated
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'))
    WITH CHECK (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));
CREATE POLICY delete_detalle_compras_ops ON public.detalle_compras 
    FOR DELETE TO authenticated
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));

-- H. Tabla AUDITORÍA
DROP POLICY IF EXISTS select_auditoria ON public.auditoria;
CREATE POLICY select_auditoria ON public.auditoria 
    FOR SELECT TO authenticated
    USING (estudio_id = (SELECT public.get_user_estudio()) AND (SELECT public.get_user_rol()) = 'admin');

-- I. Tablas LOCALES_EMPRESA y LOCAL_SERIES
DROP POLICY IF EXISTS select_locales_empresa ON public.locales_empresa;
DROP POLICY IF EXISTS all_locales_empresa_admin ON public.locales_empresa;
DROP POLICY IF EXISTS insert_locales_empresa_admin ON public.locales_empresa;
DROP POLICY IF EXISTS update_locales_empresa_admin ON public.locales_empresa;
DROP POLICY IF EXISTS delete_locales_empresa_admin ON public.locales_empresa;
CREATE POLICY select_locales_empresa ON public.locales_empresa
    FOR SELECT TO authenticated
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]));
CREATE POLICY insert_locales_empresa_admin ON public.locales_empresa
    FOR INSERT TO authenticated
    WITH CHECK (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) = 'admin');
CREATE POLICY update_locales_empresa_admin ON public.locales_empresa
    FOR UPDATE TO authenticated
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) = 'admin')
    WITH CHECK (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) = 'admin');
CREATE POLICY delete_locales_empresa_admin ON public.locales_empresa
    FOR DELETE TO authenticated
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) = 'admin');

DROP POLICY IF EXISTS select_local_series ON public.local_series;
DROP POLICY IF EXISTS all_local_series_admin ON public.local_series;
DROP POLICY IF EXISTS insert_local_series_admin ON public.local_series;
DROP POLICY IF EXISTS update_local_series_admin ON public.local_series;
DROP POLICY IF EXISTS delete_local_series_admin ON public.local_series;
CREATE POLICY select_local_series ON public.local_series
    FOR SELECT TO authenticated
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]));
CREATE POLICY insert_local_series_admin ON public.local_series
    FOR INSERT TO authenticated
    WITH CHECK (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) = 'admin');
CREATE POLICY update_local_series_admin ON public.local_series
    FOR UPDATE TO authenticated
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) = 'admin')
    WITH CHECK (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) = 'admin');
CREATE POLICY delete_local_series_admin ON public.local_series
    FOR DELETE TO authenticated
    USING (empresa_id = ANY((SELECT private.get_user_empresa_ids())::uuid[]) AND (SELECT public.get_user_rol()) = 'admin');
