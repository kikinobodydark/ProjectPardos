-- ============================================================================
-- Migración: Columna email en public.usuarios y RPC actualizar_correo_usuario
-- ============================================================================

ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS email TEXT;

UPDATE public.usuarios u
SET email = au.email
FROM auth.users au
WHERE au.id = u.id
  AND u.email IS DISTINCT FROM au.email;

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

REVOKE ALL ON FUNCTION public.actualizar_correo_usuario(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.actualizar_correo_usuario(UUID, TEXT) TO authenticated;
