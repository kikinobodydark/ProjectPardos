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
    v_estudio_id := public.get_user_estudio();
    IF v_estudio_id IS NOT NULL THEN
        NEW.estudio_id := v_estudio_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS trg_set_empresa_estudio ON public.empresas;
CREATE TRIGGER trg_set_empresa_estudio 
    BEFORE INSERT ON public.empresas
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
-- 5. RPCS PARA GESTIÓN DE USUARIOS (Endurecidas con bcrypt cost 12 y auditoría)
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

    IF array_length(p_empresa_ids, 1) IS NULL OR array_length(p_empresa_ids, 1) = 0 THEN
        RAISE EXCEPTION 'Debes asignar al menos una empresa al colaborador.';
    END IF;
    
    v_caller_estudio_id := public.get_user_estudio();
    IF v_caller_estudio_id IS NULL THEN
        RAISE EXCEPTION 'Estudio contable no identificado.';
    END IF;
    
    FOREACH v_emp_id IN ARRAY p_empresa_ids LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.empresas WHERE id = v_emp_id AND estudio_id = v_caller_estudio_id
        ) THEN
            PERFORM public.registrar_evento_seguridad('IDOR_EMPRESA_CREAR_USUARIO', jsonb_build_object('empresa_id', v_emp_id));
            RAISE EXCEPTION 'No tienes permisos para asignar empresas de otro estudio.';
        END IF;
    END LOOP;

    IF length(v_clean_email) > 254 OR v_clean_email !~* '^[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
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

    INSERT INTO auth.identities (
        id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) VALUES (
        v_user_id, v_user_id, jsonb_build_object('sub', v_user_id::text, 'email', v_clean_email), 'email', v_user_id::text, now(), now(), now()
    );

    INSERT INTO public.usuarios (id, empresa_id, estudio_id, nombre, rol, activo)
    VALUES (v_user_id, p_empresa_ids[1], v_caller_estudio_id, v_clean_nombre, p_rol, true);

    INSERT INTO public.usuario_empresas (usuario_id, empresa_id)
    SELECT v_user_id, unnest(p_empresa_ids);

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
        IF array_length(p_empresa_ids, 1) IS NULL OR array_length(p_empresa_ids, 1) = 0 THEN
            RAISE EXCEPTION 'Debes asignar al menos una empresa al colaborador.';
        END IF;

        FOREACH v_emp_id IN ARRAY p_empresa_ids LOOP
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
    END IF;

    IF p_empresa_ids IS NOT NULL THEN
        DELETE FROM public.usuario_empresas WHERE usuario_id = p_id;
        
        INSERT INTO public.usuario_empresas (usuario_id, empresa_id)
        SELECT p_id, unnest(p_empresa_ids);

        UPDATE public.usuarios 
        SET nombre = v_clean_nombre, 
            rol = p_rol, 
            activo = p_activo,
            empresa_id = p_empresa_ids[1]
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

    DELETE FROM auth.users WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

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
REVOKE EXECUTE ON FUNCTION public.eliminar_usuario(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.registrar_evento_seguridad(TEXT, JSONB) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_user_estudio() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_rol() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_empresa_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crear_estudio_empresa_y_admin(TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crear_usuario(TEXT, TEXT, TEXT, TEXT, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.actualizar_usuario(UUID, TEXT, TEXT, BOOLEAN, TEXT, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_usuario(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_evento_seguridad(TEXT, JSONB) TO authenticated;

-- ==========================================
-- 7. HABILITAR RLS Y DEFINIR POLÍTICAS (TO authenticated + Aislamiento por Empresa Asignada)
-- ==========================================
ALTER TABLE public.estudios          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empresas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuario_empresas  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.periodos_carga    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detalle_ventas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detalle_compras   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria         ENABLE ROW LEVEL SECURITY;

-- A. Tabla ESTUDIOS
DROP POLICY IF EXISTS select_estudio ON public.estudios;
CREATE POLICY select_estudio ON public.estudios 
    FOR SELECT TO authenticated
    USING (id = (SELECT public.get_user_estudio()));

-- B. Tabla EMPRESAS
DROP POLICY IF EXISTS select_empresas ON public.empresas;
CREATE POLICY select_empresas ON public.empresas 
    FOR SELECT TO authenticated
    USING (
        estudio_id = (SELECT public.get_user_estudio())
        AND (
            (SELECT public.get_user_rol()) = 'admin'
            OR (SELECT public.user_has_empresa_access(id))
        )
    );

DROP POLICY IF EXISTS all_empresas_admin ON public.empresas;
CREATE POLICY all_empresas_admin ON public.empresas 
    FOR ALL TO authenticated
    USING (estudio_id = (SELECT public.get_user_estudio()) AND (SELECT public.get_user_rol()) = 'admin')
    WITH CHECK (estudio_id = (SELECT public.get_user_estudio()) AND (SELECT public.get_user_rol()) = 'admin');

-- C. Tabla USUARIOS
DROP POLICY IF EXISTS select_usuarios ON public.usuarios;
CREATE POLICY select_usuarios ON public.usuarios 
    FOR SELECT TO authenticated
    USING (estudio_id = (SELECT public.get_user_estudio()));

DROP POLICY IF EXISTS all_usuarios_admin ON public.usuarios;
CREATE POLICY all_usuarios_admin ON public.usuarios 
    FOR ALL TO authenticated
    USING (estudio_id = (SELECT public.get_user_estudio()) AND (SELECT public.get_user_rol()) = 'admin')
    WITH CHECK (estudio_id = (SELECT public.get_user_estudio()) AND (SELECT public.get_user_rol()) = 'admin');

-- D. Tabla USUARIO_EMPRESAS
DROP POLICY IF EXISTS select_usuario_empresas ON public.usuario_empresas;
CREATE POLICY select_usuario_empresas ON public.usuario_empresas
    FOR SELECT TO authenticated
    USING (
        usuario_id = (SELECT auth.uid())
        OR (
            (SELECT public.get_user_rol()) = 'admin'
            AND empresa_id IN (SELECT id FROM public.empresas WHERE estudio_id = (SELECT public.get_user_estudio()))
        )
    );

DROP POLICY IF EXISTS all_usuario_empresas_admin ON public.usuario_empresas;
CREATE POLICY all_usuario_empresas_admin ON public.usuario_empresas
    FOR ALL TO authenticated
    USING ((SELECT public.get_user_rol()) = 'admin' AND empresa_id IN (SELECT id FROM public.empresas WHERE estudio_id = (SELECT public.get_user_estudio())))
    WITH CHECK ((SELECT public.get_user_rol()) = 'admin' AND empresa_id IN (SELECT id FROM public.empresas WHERE estudio_id = (SELECT public.get_user_estudio())));

-- E. Tabla PERIODOS DE CARGA (Aislamiento por empresa asignada)
DROP POLICY IF EXISTS select_periodos ON public.periodos_carga;
CREATE POLICY select_periodos ON public.periodos_carga 
    FOR SELECT TO authenticated
    USING ((SELECT public.user_has_empresa_access(empresa_id)));

DROP POLICY IF EXISTS all_periodos_ops ON public.periodos_carga;
CREATE POLICY all_periodos_ops ON public.periodos_carga 
    FOR ALL TO authenticated
    USING ((SELECT public.user_has_empresa_access(empresa_id)) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'))
    WITH CHECK ((SELECT public.user_has_empresa_access(empresa_id)) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));

-- F. Tabla DETALLE DE VENTAS
DROP POLICY IF EXISTS select_detalle_ventas ON public.detalle_ventas;
CREATE POLICY select_detalle_ventas ON public.detalle_ventas 
    FOR SELECT TO authenticated
    USING ((SELECT public.user_has_empresa_access(empresa_id)));

DROP POLICY IF EXISTS all_detalle_ventas_ops ON public.detalle_ventas;
CREATE POLICY all_detalle_ventas_ops ON public.detalle_ventas 
    FOR ALL TO authenticated
    USING ((SELECT public.user_has_empresa_access(empresa_id)) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'))
    WITH CHECK ((SELECT public.user_has_empresa_access(empresa_id)) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));

-- G. Tabla DETALLE DE COMPRAS
DROP POLICY IF EXISTS select_detalle_compras ON public.detalle_compras;
CREATE POLICY select_detalle_compras ON public.detalle_compras 
    FOR SELECT TO authenticated
    USING ((SELECT public.user_has_empresa_access(empresa_id)));

DROP POLICY IF EXISTS all_detalle_compras_ops ON public.detalle_compras;
CREATE POLICY all_detalle_compras_ops ON public.detalle_compras 
    FOR ALL TO authenticated
    USING ((SELECT public.user_has_empresa_access(empresa_id)) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'))
    WITH CHECK ((SELECT public.user_has_empresa_access(empresa_id)) AND (SELECT public.get_user_rol()) IN ('admin', 'operador'));

-- H. Tabla AUDITORÍA
DROP POLICY IF EXISTS select_auditoria ON public.auditoria;
CREATE POLICY select_auditoria ON public.auditoria 
    FOR SELECT TO authenticated
    USING (estudio_id = (SELECT public.get_user_estudio()) AND (SELECT public.get_user_rol()) = 'admin');
