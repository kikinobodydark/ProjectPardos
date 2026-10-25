import React, { useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { FiMail, FiLock, FiAlertCircle, FiArrowRight } from 'react-icons/fi';

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
      style={{ 
        backgroundColor: '#F8FAFC',
        backgroundImage: 'radial-gradient(at 50% 0%, rgba(37, 99, 235, 0.06) 0px, transparent 60%)'
      }}
    >
      <div 
        className="card-premium animate-fade-in w-100 p-4 p-md-5" 
        style={{ 
          maxWidth: '440px',
          borderRadius: '16px',
          boxShadow: '0 20px 25px -5px rgba(15, 23, 42, 0.08), 0 8px 10px -6px rgba(15, 23, 42, 0.04)'
        }}
      >
        <div className="text-center mb-4">
          <div 
            className="rounded-3 d-inline-flex align-items-center justify-content-center mb-3" 
            style={{ 
              width: '54px', 
              height: '54px',
              background: 'linear-gradient(135deg, #1E293B 0%, #0F172A 100%)',
              color: '#FFFFFF',
              fontWeight: 800,
              fontSize: '1.4rem',
              letterSpacing: '-0.04em',
              boxShadow: '0 6px 14px -3px rgba(15, 23, 42, 0.25)'
            }}
          >
            CT
          </div>
          <div className="d-flex align-items-center justify-content-center gap-2 mb-1">
            <h3 className="fw-bold mb-0" style={{ color: 'var(--color-text)', letterSpacing: '-0.02em', fontSize: '1.5rem' }}>
              ConciliaTributo
            </h3>
            <span 
              className="badge" 
              style={{ 
                fontSize: '0.72rem', 
                backgroundColor: 'rgba(220, 38, 38, 0.08)', 
                color: '#DC2626',
                border: '1px solid rgba(220, 38, 38, 0.2)'
              }}
            >
              Pardos
            </span>
          </div>
          <p className="text-muted" style={{ fontSize: '0.86rem' }}>
            Accede al sistema de auditoría fiscal y conciliación
          </p>
        </div>

        {errorMsg && (
          <div className="alert alert-danger d-flex align-items-center py-2.5 px-3 mb-4 border-0 rounded-3 animate-fade-in" style={{ fontSize: '0.84rem' }}>
            <FiAlertCircle className="me-2 fs-5 flex-shrink-0" />
            <div>{errorMsg}</div>
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div className="mb-3">
            <label className="form-label text-muted fw-semibold" style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Correo Electrónico
            </label>
            <div className="input-group">
              <span className="input-group-text border" style={{ backgroundColor: '#F8FAFC', borderColor: 'var(--border-color)', color: '#64748B' }}>
                <FiMail />
              </span>
              <input
                type="email"
                required
                className="form-control form-control-premium"
                placeholder="operador@pardoschicken.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="form-label text-muted fw-semibold" style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Contraseña
            </label>
            <div className="input-group">
              <span className="input-group-text border" style={{ backgroundColor: '#F8FAFC', borderColor: 'var(--border-color)', color: '#64748B' }}>
                <FiLock />
              </span>
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
            className="btn btn-primary w-100 py-2.5 rounded-3 fw-bold d-flex align-items-center justify-content-center gap-2 shadow-sm"
            style={{ cursor: loading ? 'not-allowed' : 'pointer', fontSize: '0.95rem' }}
          >
            {loading ? (
              <>
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                <span>Validando credenciales...</span>
              </>
            ) : (
              <>
                <span>Ingresar al Sistema</span>
                <FiArrowRight />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
