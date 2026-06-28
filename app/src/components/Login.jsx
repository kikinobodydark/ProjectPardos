import React, { useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { FiMail, FiLock, FiUser, FiBriefcase, FiAlertCircle } from 'react-icons/fi';

export default function Login({ onLoginSuccess }) {
  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [ruc, setRuc] = useState('');
  const [razonSocial, setRazonSocial] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
      
      // Fetch user profile to verify they have a linked company
      const { data: profile, error: profileErr } = await supabase
        .from('usuarios')
        .select('*, empresas(*)')
        .eq('id', data.user.id)
        .single();

      if (profileErr || !profile) {
        // User logged in but has no profile/company link (usually occurs if registration wasn't finished)
        // We'll let them complete the signup process or show an error
        setErrorMsg('El usuario está registrado pero no tiene un perfil/empresa asociado. Utiliza el modo Registro.');
        await supabase.auth.signOut();
        setLoading(false);
        return;
      }

      onLoginSuccess(data.user, profile);
    } catch (error) {
      console.error(error);
      setErrorMsg(error.message || 'Error al iniciar sesión. Verifica tus credenciales.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    try {
      if (ruc.length !== 11 || !/^\d+$/.test(ruc)) {
        throw new Error('El RUC debe tener exactamente 11 dígitos numéricos.');
      }

      // 1. Sign up user in Supabase Auth
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (signUpError) throw signUpError;
      if (!authData.user) throw new Error('No se pudo crear el usuario.');

      // 2. Call the DB RPC function to create the company and link user as admin
      const { data: empresaId, error: rpcError } = await supabase.rpc(
        'crear_empresa_y_vincular_admin',
        {
          p_ruc: ruc,
          p_razon_social: razonSocial,
          p_nombre_admin: nombre
        }
      );

      if (rpcError) {
        // Cleanup Auth user if DB setup fails
        // Supabase has no easy delete user from client side, but the user is unlinked so it will warn them.
        throw rpcError;
      }

      setSuccessMsg('¡Registro exitoso! Ya puedes iniciar sesión con tus credenciales.');
      setIsSignUpMode(false);
      setPassword('');
    } catch (error) {
      console.error(error);
      setErrorMsg(error.message || 'Error en el registro. Verifica los datos.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className="d-flex align-items-center justify-content-center min-vh-100 px-3"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <div 
        className="card-premium animate-fade-in w-100" 
        style={{ maxWidth: isSignUpMode ? '500px' : '400px' }}
      >
        <div className="text-center mb-4">
          <div 
            className="bg-primary rounded-circle d-inline-flex align-items-center justify-content-center mb-3" 
            style={{ width: '56px', height: '56px' }}
          >
            <span className="text-white fw-bold fs-3">C</span>
          </div>
          <h3 className="fw-bold text-white mb-1">
            {isSignUpMode ? 'Crear Cuenta Administradora' : 'Iniciar Sesión'}
          </h3>
          <p className="text-muted" style={{ fontSize: '0.88rem' }}>
            {isSignUpMode 
              ? 'Registra tu empresa y obtén acceso total como administrador' 
              : 'Accede al validador y conciliador contable'}
          </p>
        </div>

        {errorMsg && (
          <div className="alert alert-danger d-flex align-items-center py-2 px-3 mb-3 border-0 rounded-3" style={{ fontSize: '0.85rem' }}>
            <FiAlertCircle className="me-2 fs-5" />
            <div>{errorMsg}</div>
          </div>
        )}

        {successMsg && (
          <div className="alert alert-success d-flex align-items-center py-2 px-3 mb-3 border-0 rounded-3" style={{ fontSize: '0.85rem' }}>
            <FiAlertCircle className="me-2 fs-5" />
            <div>{successMsg}</div>
          </div>
        )}

        <form onSubmit={isSignUpMode ? handleSignUp : handleLogin}>
          {isSignUpMode && (
            <>
              <div className="mb-3">
                <label className="form-label text-muted" style={{ fontSize: '0.8rem' }}>Nombre Completo</label>
                <div className="input-group">
                  <span className="input-group-text border-0 bg-dark text-muted"><FiUser /></span>
                  <input
                    type="text"
                    required
                    className="form-control form-control-premium"
                    placeholder="Ej. Juan Pérez"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                  />
                </div>
              </div>

              <div className="row">
                <div className="col-md-6 mb-3">
                  <label className="form-label text-muted" style={{ fontSize: '0.8rem' }}>RUC Empresa</label>
                  <div className="input-group">
                    <span className="input-group-text border-0 bg-dark text-muted"><FiBriefcase /></span>
                    <input
                      type="text"
                      maxLength={11}
                      required
                      className="form-control form-control-premium font-mono"
                      placeholder="11 dígitos"
                      value={ruc}
                      onChange={(e) => setRuc(e.target.value)}
                    />
                  </div>
                </div>
                <div className="col-md-6 mb-3">
                  <label className="form-label text-muted" style={{ fontSize: '0.8rem' }}>Razón Social</label>
                  <input
                    type="text"
                    required
                    className="form-control form-control-premium"
                    placeholder="Nombre empresa"
                    value={razonSocial}
                    onChange={(e) => setRazonSocial(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          <div className="mb-3">
            <label className="form-label text-muted" style={{ fontSize: '0.8rem' }}>Correo Electrónico</label>
            <div className="input-group">
              <span className="input-group-text border-0 bg-dark text-muted"><FiMail /></span>
              <input
                type="email"
                required
                className="form-control form-control-premium"
                placeholder="correo@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="form-label text-muted" style={{ fontSize: '0.8rem' }}>Contraseña</label>
            <div className="input-group">
              <span className="input-group-text border-0 bg-dark text-muted"><FiLock /></span>
              <input
                type="password"
                required
                className="form-control form-control-premium"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary w-100 py-2.5 rounded-3 fw-semibold"
            style={{ cursor: 'pointer' }}
          >
            {loading ? 'Procesando...' : isSignUpMode ? 'Registrar Empresa & Cuenta' : 'Ingresar'}
          </button>
        </form>

        <div className="text-center mt-4">
          <span className="text-muted" style={{ fontSize: '0.85rem' }}>
            {isSignUpMode ? '¿Ya tienes una cuenta?' : '¿Quieres registrar tu empresa?'}
          </span>
          <button
            type="button"
            className="btn btn-link p-0 ms-2 text-decoration-none text-primary"
            style={{ fontSize: '0.85rem', fontWeight: '500', cursor: 'pointer' }}
            onClick={() => {
              setIsSignUpMode(!isSignUpMode);
              setErrorMsg('');
              setSuccessMsg('');
            }}
          >
            {isSignUpMode ? 'Iniciar Sesión' : 'Registrar Empresa'}
          </button>
        </div>
      </div>
    </div>
  );
}
