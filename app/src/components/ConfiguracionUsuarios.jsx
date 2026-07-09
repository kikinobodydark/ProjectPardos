import React, { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '../utils/supabaseClient';
import { FiPlus, FiEdit2, FiTrash2, FiCheck, FiAlertTriangle, FiUserCheck, FiKey } from 'react-icons/fi';

export default function ConfiguracionUsuarios({ activeCompany, userProfile }) {
  // Formulario
  const [editingId, setEditingId] = useState(null);
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState('operador');
  const [activo, setActivo] = useState(true);
  const [empresaIds, setEmpresaIds] = useState([]);

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Sync empresaIds with activeCompany on initial load/creation mode
  useEffect(() => {
    if (activeCompany?.id && !editingId) {
      setEmpresaIds([activeCompany.id]);
    }
  }, [activeCompany, editingId]);

  // TanStack Query para obtener la lista de empresas (para asignar al usuario)
  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('empresas')
        .select('*')
        .order('razon_social', { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const activeCompanies = companies.filter(c => c.activo === true);

  // TanStack Query para obtener la lista de usuarios del estudio (con join de empresas y relaciones muchos a muchos)
  const { data: usuarios = [], isLoading, refetch } = useQuery({
    queryKey: ['usuarios', userProfile?.estudio_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('usuarios')
        .select('*, empresas!usuarios_empresa_id_fkey(*), usuario_empresas(empresa_id, empresas(razon_social))')
        .eq('estudio_id', userProfile.estudio_id)
        .order('nombre', { ascending: true });

      if (error) throw error;
      return data || [];
    },
    enabled: !!userProfile?.estudio_id,
  });

  const resetForm = () => {
    setEditingId(null);
    setNombre('');
    setEmail('');
    setPassword('');
    setRol('operador');
    setActivo(true);
    setEmpresaIds(activeCompany?.id ? [activeCompany.id] : []);
    setErrorMsg('');
  };

  // TanStack Mutation para guardar/crear usuario
  const saveUserMutation = useMutation({
    mutationFn: async (payload) => {
      if (payload.id) {
        // Actualizar usuario
        const { error } = await supabase.rpc('actualizar_usuario', {
          p_id: payload.id,
          p_nombre: payload.nombre,
          p_rol: payload.rol,
          p_activo: payload.activo,
          p_password: payload.password || null,
          p_empresa_ids: payload.empresaIds
        });
        if (error) throw error;
      } else {
        // Crear usuario
        const { error } = await supabase.rpc('crear_usuario', {
          p_email: payload.email,
          p_password: payload.password,
          p_nombre: payload.nombre,
          p_rol: payload.rol,
          p_empresa_ids: payload.empresaIds
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
    }
  });

  // TanStack Mutation para eliminar usuario
  const deleteUserMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.rpc('eliminar_usuario', {
        p_id: id
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setSuccessMsg('Usuario eliminado correctamente del sistema.');
      refetch();
    },
    onError: (err) => {
      setErrorMsg(err.message || 'Error al eliminar el usuario.');
    }
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!editingId && !password) {
      setErrorMsg('La contraseña es obligatoria para nuevos usuarios.');
      return;
    }

    if (empresaIds.length === 0) {
      setErrorMsg('Debes asignar al menos una empresa al colaborador.');
      return;
    }

    saveUserMutation.mutate({
      id: editingId,
      nombre,
      email,
      password,
      rol,
      activo,
      empresaIds
    });
  };

  const handleDelete = (id) => {
    const confirmMsg = '¿Estás seguro de que deseas eliminar permanentemente este colaborador? Esta acción eliminará su cuenta de acceso y es irreversible.\n\nTip: Si solo quieres suspender su acceso, desactívalo desmarcando "Colaborador Activo" al editar.';
    if (window.confirm(confirmMsg)) {
      deleteUserMutation.mutate(id);
    }
  };

  const loading = isLoading || saveUserMutation.isPending || deleteUserMutation.isPending;

  const handleEdit = (user) => {
    setEditingId(user.id);
    setNombre(user.nombre);
    setEmail(''); // No mostramos ni editamos el email por seguridad, queda estático
    setPassword(''); // En blanco a menos que se desee cambiar
    setRol(user.rol);
    setActivo(user.activo);
    setEmpresaIds(user.usuario_empresas?.map(ue => ue.empresa_id).filter(Boolean) || []);
  };

  return (
    <div className="row g-4 animate-fade-in">
      <div className="col-lg-5">
        <div className="card-premium">
          <h5 className="mb-3 fw-bold">
            {editingId ? 'Editar Colaborador' : 'Registrar Nuevo Operador'}
          </h5>

          {errorMsg && (
            <div className="alert alert-danger py-2 px-3 mb-3 border-0 rounded-3" style={{ fontSize: '0.85rem' }}>
              <FiAlertTriangle className="me-2" /> {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="form-label text-muted" style={{ fontSize: '0.8rem' }}>Nombre Completo</label>
              <input
                type="text"
                required
                className="form-control form-control-premium"
                placeholder="Nombre del operador"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
              />
            </div>

            {!editingId && (
              <div className="mb-3">
                <label className="form-label text-muted" style={{ fontSize: '0.8rem' }}>Correo Electrónico</label>
                <input
                  type="email"
                  required
                  className="form-control form-control-premium"
                  placeholder="correo@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            )}

            <div className="mb-3">
              <label className="form-label text-muted" style={{ fontSize: '0.8rem' }}>Empresas Asignadas</label>
              <div className="d-flex flex-column gap-2 p-3 rounded-3" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', maxHeight: '180px', overflowY: 'auto' }}>
                {activeCompanies.length === 0 ? (
                  <span className="text-muted" style={{ fontSize: '0.85rem' }}>No hay empresas activas disponibles.</span>
                ) : (
                  activeCompanies.map(c => {
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
                              setEmpresaIds(empresaIds.filter(id => id !== c.id));
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
                className="form-control form-control-premium"
                placeholder={editingId ? 'Dejar en blanco para no cambiar' : 'Mínimo 8 caracteres, 1 mayúscula, 1 número'}
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

      <div className="col-lg-7">
        <div className="card-premium">
          <h5 className="mb-3 fw-bold">Equipo de Conciliación</h5>

          {successMsg && (
            <div className="alert alert-success py-2 px-3 mb-3 border-0 rounded-3" style={{ fontSize: '0.85rem' }}>
              <FiCheck className="me-2" /> {successMsg}
            </div>
          )}

          {loading ? (
            <div className="text-center py-4">
              <div className="spinner-border text-primary" role="status"></div>
            </div>
          ) : usuarios.length === 0 ? (
            <p className="text-muted mb-0">No se encontraron usuarios registrados.</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-dark table-borderless table-dense align-middle mb-0">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <th>NOMBRE</th>
                    <th>EMPRESA</th>
                    <th>ROL</th>
                    <th className="text-center">ESTADO</th>
                    <th className="text-center">ACCIONES</th>
                  </tr>
                </thead>
                <tbody>
                  {usuarios.map(user => (
                    <tr key={user.id}>
                      <td className="fw-semibold">{user.nombre}</td>
                      <td className="text-muted" style={{ fontSize: '0.85rem' }}>
                        <div className="d-flex flex-wrap gap-1">
                          {user.usuario_empresas?.map(ue => (
                            <span key={ue.empresa_id} className="badge bg-secondary border border-secondary font-mono" style={{ fontSize: '0.7rem' }}>
                              {ue.empresas?.razon_social}
                            </span>
                          )) || <span className="text-muted">Ninguna</span>}
                        </div>
                      </td>
                      <td>
                        <span className="badge bg-secondary font-mono" style={{ fontSize: '0.75rem' }}>
                          {user.rol.toUpperCase()}
                        </span>
                      </td>
                      <td className="text-center">
                        {user.activo ? (
                          <span className="badge badge-status badge-status-ok">Activo</span>
                        ) : (
                          <span className="badge badge-status badge-status-error">Inactivo</span>
                        )}
                      </td>
                      <td className="text-center">
                        <button
                          onClick={() => handleEdit(user)}
                          className="btn btn-sm btn-outline-warning me-1"
                          style={{ cursor: 'pointer' }}
                          title="Editar"
                        >
                          <FiEdit2 />
                        </button>
                        <button
                          onClick={() => handleDelete(user.id)}
                          className="btn btn-sm btn-outline-danger"
                          style={{ cursor: 'pointer' }}
                          title="Eliminar"
                          disabled={user.id === userProfile?.id}
                        >
                          <FiTrash2 />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
