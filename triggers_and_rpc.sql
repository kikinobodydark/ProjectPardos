-- 1. Helper Functions SECURITY DEFINER para RLS libre de recursión
CREATE OR REPLACE FUNCTION public.get_user_empresa()
RETURNS UUID AS $$
    SELECT empresa_id FROM public.usuarios WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_user_rol()
RETURNS TEXT AS $$
    SELECT rol FROM public.usuarios WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

-- 2. Trigger de Auditoría Automática
CREATE OR REPLACE FUNCTION public.audit_trigger_func()
RETURNS TRIGGER AS $$
DECLARE
    v_user_id UUID;
    v_empresa_id UUID;
    v_old_data JSONB := null;
    v_new_data JSONB := null;
BEGIN
    BEGIN
        v_user_id := auth.uid();
    EXCEPTION WHEN OTHERS THEN
        v_user_id := null;
    END;

    IF (TG_OP = 'DELETE') THEN
        v_old_data := to_jsonb(OLD);
        BEGIN v_empresa_id := OLD.empresa_id; EXCEPTION WHEN OTHERS THEN v_empresa_id := null; END;
    ELSIF (TG_OP = 'UPDATE') THEN
        v_old_data := to_jsonb(OLD);
        v_new_data := to_jsonb(NEW);
        BEGIN v_empresa_id := NEW.empresa_id; EXCEPTION WHEN OTHERS THEN v_empresa_id := null; END;
    ELSIF (TG_OP = 'INSERT') THEN
        v_new_data := to_jsonb(NEW);
        BEGIN v_empresa_id := NEW.empresa_id; EXCEPTION WHEN OTHERS THEN v_empresa_id := null; END;
    END IF;

    INSERT INTO public.auditoria (
        tabla_afectada, operacion, usuario_id, empresa_id, datos_anteriores, datos_nuevos, fecha_hora
    ) VALUES (
        TG_TABLE_NAME, TG_OP, v_user_id, v_empresa_id, v_old_data, v_new_data, now()
    );

    IF (TG_OP = 'DELETE') THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Asignar triggers a tablas críticas (eliminar duplicados si ya existen)
DROP TRIGGER IF EXISTS audit_empresas ON public.empresas;
CREATE TRIGGER audit_empresas AFTER INSERT OR UPDATE OR DELETE ON public.empresas
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS audit_usuarios ON public.usuarios;
CREATE TRIGGER audit_usuarios AFTER INSERT OR UPDATE OR DELETE ON public.usuarios
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS audit_periodos ON public.periodos_carga;
CREATE TRIGGER audit_periodos AFTER INSERT OR UPDATE OR DELETE ON public.periodos_carga
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

-- 3. Bootstrap RPC: Crear la primera empresa y el primer admin
CREATE OR REPLACE FUNCTION public.crear_empresa_y_vincular_admin(
    p_ruc TEXT,
    p_razon_social TEXT,
    p_nombre_admin TEXT
) RETURNS UUID AS $$
DECLARE
    v_empresa_id UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado.';
    END IF;

    -- Si ya existe un perfil asignado a este usuario, no se permite crear otro tenant
    IF EXISTS (SELECT 1 FROM public.usuarios WHERE id = auth.uid()) THEN
        RAISE EXCEPTION 'El usuario ya cuenta con un perfil asignado.';
    END IF;

    -- Crear la empresa
    INSERT INTO public.empresas (ruc, razon_social, activo)
    VALUES (p_ruc, p_razon_social, true)
    RETURNING id INTO v_empresa_id;

    -- Crear el perfil administrador
    INSERT INTO public.usuarios (id, empresa_id, nombre, rol, activo)
    VALUES (auth.uid(), v_empresa_id, p_nombre_admin, 'admin', true);

    RETURN v_empresa_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. RPCs para Gestión de Usuarios
CREATE OR REPLACE FUNCTION public.crear_usuario(
    p_email TEXT,
    p_password TEXT,
    p_nombre TEXT,
    p_rol TEXT,
    p_empresa_id UUID
) RETURNS UUID AS $$
DECLARE
    v_user_id UUID;
    v_encrypted_pw TEXT;
BEGIN
    IF public.get_user_rol() <> 'admin' THEN
        RAISE EXCEPTION 'Solo administradores pueden crear usuarios.';
    END IF;
    
    IF public.get_user_empresa() <> p_empresa_id THEN
        RAISE EXCEPTION 'No tiene permiso para crear usuarios en otra empresa.';
    END IF;

    v_user_id := gen_random_uuid();
    v_encrypted_pw := crypt(p_password, gen_salt('bf'));

    INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, 
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
        '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', 
        p_email, v_encrypted_pw, now(), 
        '{"provider":"email","providers":["email"]}', json_build_object('nombre', p_nombre), 
        now(), now()
    );

    INSERT INTO auth.identities (
        id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) VALUES (
        v_user_id, v_user_id, json_build_object('sub', v_user_id, 'email', p_email), 'email', now(), now(), now()
    );

    INSERT INTO public.usuarios (id, empresa_id, nombre, rol, activo)
    VALUES (v_user_id, p_empresa_id, p_nombre, p_rol, true);

    RETURN v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.actualizar_usuario(
    p_id UUID,
    p_nombre TEXT,
    p_rol TEXT,
    p_activo BOOLEAN,
    p_password TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    IF public.get_user_rol() <> 'admin' THEN
        RAISE EXCEPTION 'Solo administradores pueden editar usuarios.';
    END IF;
    
    IF (SELECT empresa_id FROM public.usuarios WHERE id = p_id) <> public.get_user_empresa() THEN
        RAISE EXCEPTION 'No tiene permiso para editar usuarios de otra empresa.';
    END IF;

    UPDATE public.usuarios 
    SET nombre = p_nombre, rol = p_rol, activo = p_activo
    WHERE id = p_id;

    IF p_password IS NOT NULL AND p_password <> '' THEN
        UPDATE auth.users 
        SET encrypted_password = crypt(p_password, gen_salt('bf')),
            updated_at = now()
        WHERE id = p_id;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Habilitar RLS y definir políticas
ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.periodos_carga ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detalle_validacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria ENABLE ROW LEVEL SECURITY;

-- Evitar errores si las políticas ya existen
DROP POLICY IF EXISTS select_empresas ON public.empresas;
CREATE POLICY select_empresas ON public.empresas FOR SELECT USING (id = public.get_user_empresa());

DROP POLICY IF EXISTS all_empresas_admin ON public.empresas;
CREATE POLICY all_empresas_admin ON public.empresas FOR ALL USING (id = public.get_user_empresa() AND public.get_user_rol() = 'admin');

DROP POLICY IF EXISTS select_usuarios ON public.usuarios;
CREATE POLICY select_usuarios ON public.usuarios FOR SELECT USING (empresa_id = public.get_user_empresa());

DROP POLICY IF EXISTS all_usuarios_admin ON public.usuarios;
CREATE POLICY all_usuarios_admin ON public.usuarios FOR ALL USING (empresa_id = public.get_user_empresa() AND public.get_user_rol() = 'admin');

DROP POLICY IF EXISTS select_periodos ON public.periodos_carga;
CREATE POLICY select_periodos ON public.periodos_carga FOR SELECT USING (empresa_id = public.get_user_empresa());

DROP POLICY IF EXISTS all_periodos_ops ON public.periodos_carga;
CREATE POLICY all_periodos_ops ON public.periodos_carga FOR ALL USING (empresa_id = public.get_user_empresa() AND public.get_user_rol() IN ('admin', 'operador'));

DROP POLICY IF EXISTS select_detalle ON public.detalle_validacion;
CREATE POLICY select_detalle ON public.detalle_validacion FOR SELECT USING (
    periodo_id IN (SELECT id FROM public.periodos_carga WHERE empresa_id = public.get_user_empresa())
);

DROP POLICY IF EXISTS all_detalle_ops ON public.detalle_validacion;
CREATE POLICY all_detalle_ops ON public.detalle_validacion FOR ALL USING (
    periodo_id IN (SELECT id FROM public.periodos_carga WHERE empresa_id = public.get_user_empresa())
    AND public.get_user_rol() IN ('admin', 'operador')
);

DROP POLICY IF EXISTS select_auditoria ON public.auditoria;
CREATE POLICY select_auditoria ON public.auditoria FOR SELECT USING (
    empresa_id = public.get_user_empresa() AND public.get_user_rol() = 'admin'
);
