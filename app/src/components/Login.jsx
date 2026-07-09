import React, { useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { FiMail, FiLock, FiUser, FiBriefcase, FiAlertCircle } from 'react-icons/fi';

export default function Login({ onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
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
        .select('*, empresas!usuarios_empresa_id_fkey(*)')
        .eq('id', data.user.id)
        .single();

      if (profileErr || !profile) {
        setErrorMsg('El usuario está registrado pero no tiene un perfil/empresa asociado. Comunícate con el administrador.');
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

  return (
    <div 
      className="d-flex align-items-center justify-content-center min-vh-100 px-3"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <div 
        className="card-premium animate-fade-in w-100" 
        style={{ maxWidth: '400px' }}
      >
        <div className="text-center mb-4">
          <div 
            className="bg-primary rounded-circle d-inline-flex align-items-center justify-content-center mb-3" 
            style={{ width: '56px', height: '56px' }}
          >
            <span className="text-white fw-bold fs-3">C</span>
          </div>
          <h3 className="fw-bold text-white mb-1">
            Iniciar Sesión
          </h3>
          <p className="text-muted" style={{ fontSize: '0.88rem' }}>
            Accede al validador y conciliador contable
          </p>
        </div>

        {errorMsg && (
          <div className="alert alert-danger d-flex align-items-center py-2 px-3 mb-3 border-0 rounded-3" style={{ fontSize: '0.85rem' }}>
            <FiAlertCircle className="me-2 fs-5" />
            <div>{errorMsg}</div>
          </div>
        )}

        <form onSubmit={handleLogin}>
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
            {loading ? 'Procesando...' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}
