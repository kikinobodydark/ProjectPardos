import React, { useState, useEffect, useMemo, memo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '../utils/supabaseClient';
import {
  getOrCreateCsrfToken,
  verifyCsrfToken,
  checkRateLimit,
  sanitizeTextInput,
  logSuspiciousActivity,
} from '../utils/security';
import { SkeletonTable } from './SkeletonLoader';
import { COLS_EMPRESA, COLS_USUARIOS_LISTA } from '../utils/dbColumns';
import { FiEdit2, FiTrash2, FiCheck, FiAlertTriangle, FiLock, FiMail } from 'react-icons/fi';

const ConfiguracionUsuarios = memo(function ConfiguracionUsuarios({ activeCompany, userProfile }) {
  const [csrfToken] = useState(() => getOrCreateCsrfToken());

  // Formulario
  const [editingId, setEditingId] = useState(null);
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [originalEmail, setOriginalEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState('operador');
  const [activo, setActivo] = useState(true);
  const [empresaIds, setEmpresaIds] = useState([]);

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Paginación de usuarios
  const [pagina, setPagina] = useState(1);
  const porPagina = 10;

  const isAdmin = userProfile?.rol === 'admin';

  useEffect(() => {
    if (activeCompany?.id && !editingId) {
      setEmpresaIds([activeCompany.id]);
    }
  }, [activeCompany, editingId]);

  // Comparte queryKey con App.jsx y ConfiguracionEmpresas.jsx para evitar llamadas duplicadas
  const { data: companies = [] } = useQuery({
    queryKey: ['companies', userProfile?.id, userProfile?.rol],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('empresas')
        .select(COLS_EMPRESA)
        .order('razon_social', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: isAdmin,
  });

  const activeCompanies = companies.filter((c) => c.activo === true);

  const { data: usuarios = [], isLoading, refetch } = useQuery({
    queryKey: ['usuarios', userProfile?.estudio_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('usuarios')
        .select(COLS_USUARIOS_LISTA)
        .eq('estudio_id', userProfile.estudio_id)
        .order('nombre', { ascending: true });

      if (error) throw error;
      return data || [];
    },
    enabled: isAdmin && !!userProfile?.estudio_id,
  });

  const totalPaginas = Math.ceil(usuarios.length / porPagina);
  const usuariosPaginados = useMemo(
    () => usuarios.slice((pagina - 1) * porPagina, pagina * porPagina),
    [usuarios, pagina]
  );

  const resetForm = () => {
    setEditingId(null);
    setNombre('');
    setEmail('');
    setOriginalEmail('');
    setPassword('');
    setRol('operador');
    setActivo(true);
    setEmpresaIds(activeCompany?.id ? [activeCompany.id] : []);
    setErrorMsg('');
  };

  const saveUserMutation = useMutation({
    mutationFn: async (payload) => {
      if (payload.id) {
        if (payload.email && payload.email !== payload.originalEmail) {
          const { error: emailErr } = await supabase.rpc('actualizar_correo_usuario', {
            p_id: payload.id,
            p_email: payload.email,
          });
          if (emailErr) throw emailErr;
        }
        const { error } = await supabase.rpc('actualizar_usuario', {
          p_id: payload.id,
          p_nombre: payload.nombre,
          p_rol: payload.rol,
          p_activo: payload.activo,
          p_password: payload.password || null,
          p_empresa_ids: payload.empresaIds,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc('crear_usuario', {
          p_email: payload.email,
          p_password: payload.password,
          p_nombre: payload.nombre,
          p_rol: payload.rol,
          p_empresa_ids: payload.empresaIds,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setSuccessMsg(editingId ? 'Usuario actualizado correctamente.' : 'Usuario creado correctamente en el sistema.');
      resetForm();
      refetch();
    },
    onError: (err) => {
      setErrorMsg(err.message || 'Error al guardar el usuario.');
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.rpc('eliminar_usuario', {
        p_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setSuccessMsg('Usuario eliminado correctamente del sistema.');
      refetch();
    },
    onError: (err) => {
      setErrorMsg(err.message || 'Error al eliminar el usuario.');
    },
  });

  if (!isAdmin) {
    logSuspiciousActivity('RENDER_CONFIG_USUARIOS_NO_ADMIN', { userId: userProfile?.id });
    return (
      <div className="card-premium p-4 text-center">
        <FiLock className="text-danger fs-2 mb-2" />
        <h5 className="fw-bold">Acceso Restringido</h5>
        <p className="text-muted mb-0">Solo los administradores activos pueden gestionar usuarios.</p>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!verifyCsrfToken(csrfToken)) {
      setErrorMsg('Token CSRF inválido. Recarga la sesión.');
      return;
    }

    const rl = checkRateLimit('admin_user_mutation', { maxAttempts: 10, windowMs: 60000, lockoutMs: 60000 });
    if (!rl.allowed) {
      setErrorMsg(rl.message);
      return;
    }

    const cleanNombre = sanitizeTextInput(nombre, 120);
    if (cleanNombre.length < 2) {
      setErrorMsg('El nombre del colaborador debe tener al menos 2 caracteres válidos.');
      return;
    }

    const cleanEmail = sanitizeTextInput(email, 254).toLowerCase();
    if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(cleanEmail)) {
      setErrorMsg('El formato del correo electrónico no es válido.');
      return;
    }

    if (!editingId && !password) {
      setErrorMsg('La contraseña es obligatoria para nuevos usuarios.');
      return;
    }

    if (password && (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password))) {
      setErrorMsg('La contraseña debe tener mínimo 8 caracteres, al menos 1 mayúscula, 1 minúscula y 1 número.');
      return;
    }

    if (!['admin', 'operador', 'consulta'].includes(rol)) {
      setErrorMsg('Rol seleccionado inválido.');
      return;
    }

    if (empresaIds.length === 0) {
      setErrorMsg('Debes asignar al menos una empresa al colaborador.');
      return;
    }

    saveUserMutation.mutate({
      id: editingId,
      nombre: cleanNombre,
      email: cleanEmail,
      originalEmail,
      password,
      rol,
      activo,
      empresaIds,
    });
  };

  const handleDelete = (id) => {
    if (!verifyCsrfToken(csrfToken)) {
      setErrorMsg('Token CSRF inválido. Recarga la sesión.');
      return;
    }
    const rl = checkRateLimit('admin_user_delete', { maxAttempts: 5, windowMs: 60000, lockoutMs: 60000 });
    if (!rl.allowed) {
      setErrorMsg(rl.message);
      return;
    }
    const confirmMsg =
      '¿Estás seguro de que deseas eliminar permanentemente este colaborador? Esta acción eliminará su cuenta de acceso y es irreversible.\n\nTip: Si solo quieres suspender su acceso, desactívalo desmarcando "Colaborador Activo" al editar.';
    if (window.confirm(confirmMsg)) {
      deleteUserMutation.mutate(id);
    }
  };

  const loading = isLoading || saveUserMutation.isPending || deleteUserMutation.isPending;

  const handleEdit = (user) => {
    setEditingId(user.id);
    setNombre(user.nombre);
    setEmail(user.email || '');
    setOriginalEmail((user.email || '').toLowerCase());
    setPassword('');
    setRol(user.rol);
    setActivo(user.activo);
    setEmpresaIds(user.usuario_empresas?.map((ue) => ue.empresa_id).filter(Boolean) || []);
    setErrorMsg('');
    setSuccessMsg('');
  };

  return (
    <div className="row g-4 animate-fade-in">
      <div className="col-lg-4">
        <div className="card-premium">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h5 className="mb-0 fw-bold">
              {editingId ? 'Editar Colaborador' : 'Registrar Nuevo Operador'}
            </h5>
            {editingId && (
              <span className="badge badge-status badge-status-observado">Editando</span>
            )}
          </div>

          {errorMsg && (
            <div className="alert alert-danger py-2 px-3 mb-3 border-0 rounded-3" style={{ fontSize: '0.85rem' }}>
              <FiAlertTriangle className="me-2" /> {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} autoComplete="off">
            <input type="hidden" name="csrf_token" value={csrfToken} readOnly />
            <div className="mb-3">
              <label className="form-label text-muted fw-semibold" style={{ fontSize: '0.78rem' }}>Nombre Completo</label>
              <input
                type="text"
                required
                maxLength={120}
                className="form-control form-control-premium"
                placeholder="Nombre del operador"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
              />
            </div>

            <div className="mb-3">
              <label className="form-label text-muted fw-semibold" style={{ fontSize: '0.78rem' }}>Correo Electrónico</label>
              <input
                type="email"
                required
                maxLength={254}
                className="form-control form-control-premium"
                placeholder="correo@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="mb-3">
              <label className="form-label text-muted" style={{ fontSize: '0.8rem' }}>Empresas Asignadas</label>
              <div className="d-flex flex-column gap-2 p-3 rounded-3" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', maxHeight: '180px', overflowY: 'auto' }}>
                {activeCompanies.length === 0 ? (
                  <span className="text-muted" style={{ fontSize: '0.85rem' }}>No hay empresas activas disponibles.</span>
                ) : (
                  activeCompanies.map((c) => {
                    const isChecked = empresaIds.includes(c.id);
                    return (
                      <div key={c.id} className="d-flex align-items-center">
                        <input
                          type="checkbox"
                          id={`empresa-${c.id}`}
                          className="form-check-input me-2"
                          checked={isChecked}
                          disabled={editingId === userProfile?.id}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setEmpresaIds([...empresaIds, c.id]);
                            } else {
                              setEmpresaIds(empresaIds.filter((id) => id !== c.id));
                            }
                          }}
                        />
                        <label htmlFor={`empresa-${c.id}`} className="form-check-label text-truncate" style={{ fontSize: '0.85rem', cursor: 'pointer' }} title={c.razon_social}>
                          {c.razon_social}
                        </label>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="mb-3">
              <label className="form-label text-muted" style={{ fontSize: '0.8rem' }}>
                {editingId ? 'Nueva Contraseña (Opcional)' : 'Contraseña Inicial'}
              </label>
              <input
                type="password"
                required={!editingId}
                maxLength={128}
                autoComplete="new-password"
                className="form-control form-control-premium"
                placeholder={editingId ? 'Dejar en blanco para no cambiar' : 'Mín. 8 caracteres, mayúscula, minúscula y número'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="mb-3">
              <label className="form-label text-muted" style={{ fontSize: '0.8rem' }}>Rol / Privilegios</label>
              <select
                className="form-select form-control-premium"
                value={rol}
                onChange={(e) => setRol(e.target.value)}
                disabled={editingId === userProfile?.id}
              >
                <option value="operador">Operador (Carga y Concilia)</option>
                <option value="consulta">Consulta (Solo Lectura y Reportes)</option>
                <option value="admin">Administrador (Control Total)</option>
              </select>
            </div>

            {editingId && (
              <div className="mb-4 d-flex align-items-center">
                <input
                  type="checkbox"
                  id="user-activo"
                  className="form-check-input me-2"
                  checked={activo}
                  onChange={(e) => setActivo(e.target.checked)}
                  disabled={editingId === userProfile?.id}
                />
                <label htmlFor="user-activo" className="form-check-label" style={{ fontSize: '0.85rem' }}>Colaborador Activo</label>
              </div>
            )}

            <div className="d-flex gap-2">
              <button
                type="submit"
                className="btn btn-primary px-3 py-2 rounded-3 flex-grow-1 fw-semibold"
                style={{ cursor: 'pointer' }}
              >
                {editingId ? 'Guardar Cambios' : 'Crear Colaborador'}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="btn btn-outline-secondary px-3 py-2 rounded-3"
                  style={{ cursor: 'pointer' }}
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      <div className="col-lg-8">
        <div className="card-premium">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div>
              <h5 className="mb-0 fw-bold">Equipo de Conciliación ({usuarios.length})</h5>
              <small className="text-muted" style={{ fontSize: '0.78rem' }}>
                Haz clic en editar para modificar nombre, correo, empresas asignadas o privilegios.
              </small>
            </div>
          </div>

          {successMsg && (
            <div className="alert alert-success py-2 px-3 mb-3 border-0 rounded-3" style={{ fontSize: '0.85rem' }}>
              <FiCheck className="me-2" /> {successMsg}
            </div>
          )}

          {loading ? (
            <SkeletonTable rows={5} columns={6} title="Cargando usuarios..." />
          ) : usuarios.length === 0 ? (
            <p className="text-muted mb-0">No se encontraron usuarios registrados.</p>
          ) : (
            <>
              <div className="table-responsive">
                <table className="table table-hover table-dense align-middle mb-0">
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                      <th style={{ backgroundColor: 'var(--bg-surface)' }}>NOMBRE</th>
                      <th style={{ backgroundColor: 'var(--bg-surface)' }}>CORREO</th>
                      <th style={{ backgroundColor: 'var(--bg-surface)' }}>EMPRESA</th>
                      <th className="text-center" style={{ backgroundColor: 'var(--bg-surface)' }}>ROL</th>
                      <th className="text-center" style={{ backgroundColor: 'var(--bg-surface)' }}>ESTADO</th>
                      <th className="text-center" style={{ backgroundColor: 'var(--bg-surface)' }}>ACCIONES</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usuariosPaginados.map((user) => (
                      <tr key={user.id} className={editingId === user.id ? 'table-active' : ''}>
                        <td className="fw-semibold text-nowrap">{user.nombre}</td>
                        <td className="font-mono text-muted text-nowrap" style={{ fontSize: '0.8rem' }}>
                          {user.email ? (
                            <span className="d-inline-flex align-items-center gap-1">
                              <FiMail style={{ fontSize: '0.78rem', opacity: 0.7 }} />
                              <span>{user.email}</span>
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="text-muted" style={{ fontSize: '0.82rem' }}>
                          <div className="d-flex flex-wrap gap-1">
                            {user.usuario_empresas?.map((ue) => (
                              <span
                                key={ue.empresa_id}
                                className="badge font-mono"
                                style={{
                                  backgroundColor: 'rgba(241, 245, 249, 0.9)',
                                  color: '#334155',
                                  border: '1px solid #E2E8F0',
                                  fontSize: '0.72rem',
                                }}
                              >
                                {ue.empresas?.razon_social}
                              </span>
                            )) || <span className="text-muted">Ninguna</span>}
                          </div>
                        </td>
                        <td className="text-center text-nowrap">
                          <span
                            className="badge font-mono"
                            style={{
                              backgroundColor:
                                user.rol === 'admin'
                                  ? 'rgba(37, 99, 235, 0.1)'
                                  : user.rol === 'operador'
                                    ? 'rgba(5, 150, 105, 0.1)'
                                    : 'rgba(100, 116, 139, 0.1)',
                              color:
                                user.rol === 'admin'
                                  ? '#2563EB'
                                  : user.rol === 'operador'
                                    ? '#047857'
                                    : '#475569',
                              border: `1px solid ${
                                user.rol === 'admin'
                                  ? 'rgba(37, 99, 235, 0.2)'
                                  : user.rol === 'operador'
                                    ? 'rgba(5, 150, 105, 0.22)'
                                    : '#E2E8F0'
                              }`,
                              fontSize: '0.74rem',
                            }}
                          >
                            {user.rol.toUpperCase()}
                          </span>
                        </td>
                        <td className="text-center text-nowrap">
                          {user.activo ? (
                            <span className="badge badge-status badge-status-ok">Activo</span>
                          ) : (
                            <span className="badge badge-status badge-status-error">Inactivo</span>
                          )}
                        </td>
                        <td className="text-center text-nowrap">
                          <div className="d-inline-flex align-items-center justify-content-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleEdit(user)}
                              className="btn btn-sm btn-outline-warning"
                              style={{ cursor: 'pointer' }}
                              title="Editar colaborador"
                            >
                              <FiEdit2 />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(user.id)}
                              className="btn btn-sm btn-outline-danger"
                              style={{ cursor: 'pointer' }}
                              title="Eliminar colaborador"
                              disabled={user.id === userProfile?.id}
                            >
                              <FiTrash2 />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPaginas > 1 && (
                <div className="d-flex justify-content-between align-items-center mt-3 pt-2 border-top" style={{ borderColor: 'var(--border-color)' }}>
                  <small className="text-muted">
                    Página {pagina} de {totalPaginas}
                  </small>
                  <div className="d-flex gap-1">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      disabled={pagina <= 1}
                      onClick={() => setPagina(pagina - 1)}
                    >
                      Anterior
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      disabled={pagina >= totalPaginas}
                      onClick={() => setPagina(pagina + 1)}
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
});

export default ConfiguracionUsuarios;
