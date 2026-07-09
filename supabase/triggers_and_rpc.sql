-- ==========================================
-- 1. HELPER FUNCTIONS CON search_path FIJO
-- ==========================================
CREATE OR REPLACE FUNCTION public.get_user_estudio()
RETURNS UUID AS $$
    SELECT estudio_id FROM public.usuarios WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION public.get_user_rol()
RETURNS TEXT AS $$
    SELECT rol FROM public.usuarios WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public;

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
        -- Forzar defensivamente el estudio del administrador logueado
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
-- 3. TRIGGER DE AUDITORÍA CON SCOPE DE ESTUDIO
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
    BEGIN v_user_id := auth.uid(); EXCEPTION WHEN OTHERS THEN v_user_id := null; END;

    -- Obtener el estudio del usuario activo
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

-- Asignar triggers a tablas críticas
DROP TRIGGER IF EXISTS audit_empresas ON public.empresas;
CREATE TRIGGER audit_empresas AFTER INSERT OR UPDATE OR DELETE ON public.empresas
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS audit_usuarios ON public.usuarios;
CREATE TRIGGER audit_usuarios AFTER INSERT OR UPDATE OR DELETE ON public.usuarios
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS audit_periodos ON public.periodos_carga;
CREATE TRIGGER audit_periodos AFTER INSERT OR UPDATE OR DELETE ON public.periodos_carga
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

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
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado.'; END IF;
    IF EXISTS (SELECT 1 FROM public.estudios) THEN
        RAISE EXCEPTION 'El auto-registro está deshabilitado en este entorno.';
    END IF;

    -- Validaciones de Entrada
    IF trim(p_nombre_estudio) = '' THEN RAISE EXCEPTION 'El nombre del estudio contable está vacío.'; END IF;
    IF length(p_ruc) <> 11 OR p_ruc !~ '^\d+$' THEN RAISE EXCEPTION 'El RUC debe tener exactamente 11 dígitos.'; END IF;
    IF trim(p_razon_social) = '' THEN RAISE EXCEPTION 'La razón social está vacía.'; END IF;
    IF trim(p_nombre_admin) = '' THEN RAISE EXCEPTION 'El nombre del administrador está vacío.'; END IF;
    
    INSERT INTO public.estudios (nombre) VALUES (p_nombre_estudio) RETURNING id INTO v_estudio_id;
    INSERT INTO public.empresas (ruc, razon_social, estudio_id, activo) VALUES (p_ruc, p_razon_social, v_estudio_id, true) RETURNING id INTO v_empresa_id;
    INSERT INTO public.usuarios (id, empresa_id, estudio_id, nombre, rol, activo) VALUES (auth.uid(), v_empresa_id, v_estudio_id, p_nombre_admin, 'admin', true);
    
    RETURN v_estudio_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

-- ==========================================
-- 5. RPCS PARA GESTIÓN DE USUARIOS (Endurecidas)
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
BEGIN
    IF public.get_user_rol() <> 'admin' THEN RAISE EXCEPTION 'Solo administradores pueden crear usuarios.'; END IF;
    IF array_length(p_empresa_ids, 1) IS NULL OR array_length(p_empresa_ids, 1) = 0 THEN
        RAISE EXCEPTION 'Debes asignar al menos una empresa al colaborador.';
    END IF;
    
    v_caller_estudio_id := public.get_user_estudio();
    
    -- Validar IDOR para cada empresa asignada
    FOREACH v_emp_id IN ARRAY p_empresa_ids LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.empresas WHERE id = v_emp_id AND estudio_id = v_caller_estudio_id
        ) THEN
            RAISE EXCEPTION 'No tienes permisos para asignar empresas de otro estudio.';
        END IF;
    END LOOP;

    -- Validaciones de email y password
    IF p_email !~* '^[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN RAISE EXCEPTION 'Formato de correo electrónico inválido.'; END IF;
    IF length(p_password) < 8 THEN RAISE EXCEPTION 'La contraseña debe tener al menos 8 caracteres.'; END IF;
    IF p_password !~ '[A-Z]' THEN RAISE EXCEPTION 'La contraseña debe contener al menos una letra mayúscula.'; END IF;
    IF p_password !~ '[0-9]' THEN RAISE EXCEPTION 'La contraseña debe contener al menos un número.'; END IF;

    v_user_id := gen_random_uuid();
    v_encrypted_pw := extensions.crypt(p_password, extensions.gen_salt('bf'));

    -- Inserción alineada con el esquema de GoTrue v2 (incluyendo los tokens vacíos)
    INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous,
        confirmation_token, recovery_token, email_change_token_new, email_change,
        email_change_token_current, reauthentication_token, phone_change, phone_change_token
    ) VALUES (
        '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', 
        p_email, v_encrypted_pw, now(), 
        '{"provider":"email","providers":["email"]}', json_build_object('nombre', p_nombre), 
        now(), now(), false, false,
        '', '', '', '',
        '', '', '', ''
    );

    INSERT INTO auth.identities (
        id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) VALUES (
        v_user_id, v_user_id, json_build_object('sub', v_user_id::text, 'email', p_email), 'email', v_user_id::text, now(), now(), now()
    );

    -- Insertar en public.usuarios (usando la primera empresa como la predeterminada)
    INSERT INTO public.usuarios (id, empresa_id, estudio_id, nombre, rol, activo)
    VALUES (v_user_id, p_empresa_ids[1], v_caller_estudio_id, p_nombre, p_rol, true);

    -- Insertar relaciones muchos a muchos
    INSERT INTO public.usuario_empresas (usuario_id, empresa_id)
    SELECT v_user_id, unnest(p_empresa_ids);

    RETURN v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

-- Eliminar firma antigua para evitar sobrecarga
DROP FUNCTION IF EXISTS public.actualizar_usuario(UUID, TEXT, TEXT, BOOLEAN, TEXT, UUID);

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
BEGIN
    IF public.get_user_rol() <> 'admin' THEN RAISE EXCEPTION 'Solo administradores pueden editar usuarios.'; END IF;
    
    v_caller_estudio_id := public.get_user_estudio();
    
    -- Validar IDOR: el usuario objetivo debe pertenecer al estudio del administrador
    IF NOT EXISTS (
        SELECT 1 FROM public.usuarios 
        WHERE id = p_id AND estudio_id = v_caller_estudio_id
    ) THEN
        RAISE EXCEPTION 'El usuario objetivo no pertenece a tu estudio contable o no existe.';
    END IF;

    -- Validar IDOR de las empresas
    IF p_empresa_ids IS NOT NULL THEN
        IF array_length(p_empresa_ids, 1) IS NULL OR array_length(p_empresa_ids, 1) = 0 THEN
            RAISE EXCEPTION 'Debes asignar al menos una empresa al colaborador.';
        END IF;

        FOREACH v_emp_id IN ARRAY p_empresa_ids LOOP
            IF NOT EXISTS (
                SELECT 1 FROM public.empresas WHERE id = v_emp_id AND estudio_id = v_caller_estudio_id
            ) THEN
                RAISE EXCEPTION 'No tienes permisos para asignar empresas de otro estudio.';
            END IF;
        END LOOP;
    END IF;

    IF p_id = auth.uid() AND (p_rol <> 'admin' OR p_activo = false) THEN
        RAISE EXCEPTION 'No puedes cambiar tu propio rol de administrador ni desactivar tu propio usuario.';
    END IF;

    IF p_password IS NOT NULL AND p_password <> '' THEN
        IF length(p_password) < 8 OR p_password !~ '[A-Z]' OR p_password !~ '[0-9]' THEN
            RAISE EXCEPTION 'Contraseña débil. Requiere min 8 caracteres, una mayúscula y un número.';
        END IF;
        UPDATE auth.users 
        SET encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
            updated_at = now()
        WHERE id = p_id;
    END IF;

    -- Actualizar relaciones si se pasaron empresas
    IF p_empresa_ids IS NOT NULL THEN
        DELETE FROM public.usuario_empresas WHERE usuario_id = p_id;
        
        INSERT INTO public.usuario_empresas (usuario_id, empresa_id)
        SELECT p_id, unnest(p_empresa_ids);

        UPDATE public.usuarios 
        SET nombre = p_nombre, 
            rol = p_rol, 
            activo = p_activo,
            empresa_id = p_empresa_ids[1]
        WHERE id = p_id;
    ELSE
        UPDATE public.usuarios 
        SET nombre = p_nombre, 
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
    IF public.get_user_rol() <> 'admin' THEN RAISE EXCEPTION 'Solo administradores pueden eliminar usuarios.'; END IF;
    
    v_caller_estudio_id := public.get_user_estudio();
    
    -- Validar IDOR del usuario objetivo
    IF NOT EXISTS (
        SELECT 1 FROM public.usuarios 
        WHERE id = p_id AND estudio_id = v_caller_estudio_id
    ) THEN
        RAISE EXCEPTION 'El usuario objetivo no pertenece a tu estudio contable o no existe.';
    END IF;

    IF p_id = auth.uid() THEN
        RAISE EXCEPTION 'No puedes eliminar tu propio usuario administrador.';
    END IF;

    DELETE FROM auth.users WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

-- ==========================================
-- 6. HABILITAR RLS Y DEFINIR POLÍTICAS (Modelo B)
-- ==========================================
-- Habilitar explícitamente RLS en las 7 tablas del sistema
ALTER TABLE public.estudios          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empresas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.periodos_carga   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detalle_ventas   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detalle_compras  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria        ENABLE ROW LEVEL SECURITY;

-- A. Tabla ESTUDIOS
DROP POLICY IF EXISTS select_estudio ON public.estudios;
CREATE POLICY select_estudio ON public.estudios 
    FOR SELECT USING (id = public.get_user_estudio());

-- B. Tabla EMPRESAS
DROP POLICY IF EXISTS select_empresas ON public.empresas;
CREATE POLICY select_empresas ON public.empresas 
    FOR SELECT USING (estudio_id = public.get_user_estudio());

DROP POLICY IF EXISTS all_empresas_admin ON public.empresas;
CREATE POLICY all_empresas_admin ON public.empresas 
    FOR ALL 
    USING (estudio_id = public.get_user_estudio() AND public.get_user_rol() = 'admin')
    WITH CHECK (estudio_id = public.get_user_estudio() AND public.get_user_rol() = 'admin');

-- C. Tabla USUARIOS
DROP POLICY IF EXISTS select_usuarios ON public.usuarios;
CREATE POLICY select_usuarios ON public.usuarios 
    FOR SELECT USING (estudio_id = public.get_user_estudio());

DROP POLICY IF EXISTS all_usuarios_admin ON public.usuarios;
CREATE POLICY all_usuarios_admin ON public.usuarios 
    FOR ALL 
    USING (estudio_id = public.get_user_estudio() AND public.get_user_rol() = 'admin')
    WITH CHECK (estudio_id = public.get_user_estudio() AND public.get_user_rol() = 'admin');

-- D. Tabla PERIODOS DE CARGA (Aislamiento por Estudio)
DROP POLICY IF EXISTS select_periodos ON public.periodos_carga;
CREATE POLICY select_periodos ON public.periodos_carga 
    FOR SELECT USING (empresa_id IN (SELECT id FROM public.empresas WHERE estudio_id = public.get_user_estudio()));

DROP POLICY IF EXISTS all_periodos_ops ON public.periodos_carga;
CREATE POLICY all_periodos_ops ON public.periodos_carga 
    FOR ALL 
    USING (empresa_id IN (SELECT id FROM public.empresas WHERE estudio_id = public.get_user_estudio()) AND public.get_user_rol() IN ('admin', 'operador'))
    WITH CHECK (empresa_id IN (SELECT id FROM public.empresas WHERE estudio_id = public.get_user_estudio()) AND public.get_user_rol() IN ('admin', 'operador'));

-- E. Tabla DETALLE DE VENTAS
DROP POLICY IF EXISTS select_detalle_ventas ON public.detalle_ventas;
CREATE POLICY select_detalle_ventas ON public.detalle_ventas 
    FOR SELECT USING (empresa_id IN (SELECT id FROM public.empresas WHERE estudio_id = public.get_user_estudio()));

DROP POLICY IF EXISTS all_detalle_ventas_ops ON public.detalle_ventas;
CREATE POLICY all_detalle_ventas_ops ON public.detalle_ventas 
    FOR ALL 
    USING (empresa_id IN (SELECT id FROM public.empresas WHERE estudio_id = public.get_user_estudio()) AND public.get_user_rol() IN ('admin', 'operador'))
    WITH CHECK (empresa_id IN (SELECT id FROM public.empresas WHERE estudio_id = public.get_user_estudio()) AND public.get_user_rol() IN ('admin', 'operador'));

-- F. Tabla DETALLE DE COMPRAS
DROP POLICY IF EXISTS select_detalle_compras ON public.detalle_compras;
CREATE POLICY select_detalle_compras ON public.detalle_compras 
    FOR SELECT USING (empresa_id IN (SELECT id FROM public.empresas WHERE estudio_id = public.get_user_estudio()));

DROP POLICY IF EXISTS all_detalle_compras_ops ON public.detalle_compras;
CREATE POLICY all_detalle_compras_ops ON public.detalle_compras 
    FOR ALL 
    USING (empresa_id IN (SELECT id FROM public.empresas WHERE estudio_id = public.get_user_estudio()) AND public.get_user_rol() IN ('admin', 'operador'))
    WITH CHECK (empresa_id IN (SELECT id FROM public.empresas WHERE estudio_id = public.get_user_estudio()) AND public.get_user_rol() IN ('admin', 'operador'));

-- G. Tabla AUDITORÍA (Aislamiento por Estudio en columna estudio_id)
DROP POLICY IF EXISTS select_auditoria ON public.auditoria;
CREATE POLICY select_auditoria ON public.auditoria 
    FOR SELECT USING (estudio_id = public.get_user_estudio() AND public.get_user_rol() = 'admin');
