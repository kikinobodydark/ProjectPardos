import React, { useState, useEffect } from 'react';
import { supabase } from '../utils/supabaseClient';
import { FiPlus, FiEdit2, FiTrash2, FiCheck, FiX, FiAlertTriangle } from 'react-icons/fi';

export default function ConfiguracionEmpresas({ activeCompany }) {
  const [empresas, setEmpresas] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // Formulario
  const [editingId, setEditingId] = useState(null);
  const [ruc, setRuc] = useState('');
  const [razonSocial, setRazonSocial] = useState('');
  const [activo, setActivo] = useState(true);
  
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    fetchEmpresas();
  }, []);

  const fetchEmpresas = async () => {
    setLoading(true);
    try {
      // Nota: RLS filtrará automáticamente para que solo vean las que tienen derecho
      const { data, error } = await supabase
        .from('empresas')
        .select('*')
        .order('razon_social', { ascending: true });

      if (error) throw error;
      setEmpresas(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setRuc('');
    setRazonSocial('');
    setActivo(true);
    setErrorMsg('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (ruc.length !== 11 || !/^\d+$/.test(ruc)) {
      setErrorMsg('El RUC debe tener exactamente 11 caracteres numéricos.');
      return;
    }

    try {
      if (editingId) {
        // Actualizar empresa
        const { error } = await supabase
          .from('empresas')
          .update({
            ruc,
            razon_social: razonSocial,
            activo
          })
          .eq('id', editingId);

        if (error) throw error;
        setSuccessMsg('Empresa actualizada correctamente.');
      } else {
        // Crear empresa
        const { error } = await supabase
          .from('empresas')
          .insert({
            ruc,
            razon_social: razonSocial,
            activo: true
          });

        if (error) throw error;
        setSuccessMsg('Empresa creada correctamente.');
      }

      resetForm();
      fetchEmpresas();
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || 'Error al guardar empresa.');
    }
  };

  const handleEdit = (emp) => {
    setEditingId(emp.id);
    setRuc(emp.ruc);
    setRazonSocial(emp.razon_social);
    setActivo(emp.activo);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('¿Estás seguro de que deseas eliminar esta empresa? Todos los datos relacionados se perderán.')) return;
    
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const { error } = await supabase
        .from('empresas')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setSuccessMsg('Empresa eliminada correctamente.');
      fetchEmpresas();
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || 'Error al eliminar empresa.');
    }
  };

  return (
    <div className="row g-4 animate-fade-in">
      <div className="col-lg-5">
        <div className="card-premium">
          <h5 className="text-white mb-3 fw-bold">
            {editingId ? 'Editar Empresa' : 'Registrar Nueva Empresa'}
          </h5>
          
          {errorMsg && (
            <div className="alert alert-danger py-2 px-3 mb-3 border-0 rounded-3" style={{ fontSize: '0.85rem' }}>
              <FiAlertTriangle className="me-2" /> {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="form-label text-muted" style={{ fontSize: '0.8rem' }}>RUC</label>
              <input
                type="text"
                required
                maxLength={11}
                className="form-control form-control-premium font-mono"
                placeholder="11 dígitos"
                value={ruc}
                onChange={(e) => setRuc(e.target.value)}
              />
            </div>

            <div className="mb-3">
              <label className="form-label text-muted" style={{ fontSize: '0.8rem' }}>Razón Social</label>
              <input
                type="text"
                required
                className="form-control form-control-premium"
                placeholder="Nombre comercial o social"
                value={razonSocial}
                onChange={(e) => setRazonSocial(e.target.value)}
              />
            </div>

            {editingId && (
              <div className="mb-4 d-flex align-items-center">
                <input
                  type="checkbox"
                  id="activo"
                  className="form-check-input me-2"
                  checked={activo}
                  onChange={(e) => setActivo(e.target.checked)}
                />
                <label htmlFor="activo" className="form-check-label text-white" style={{ fontSize: '0.85rem' }}>Empresa Activa</label>
              </div>
            )}

            <div className="d-flex gap-2">
              <button
                type="submit"
                className="btn btn-primary px-3 py-2 rounded-3 flex-grow-1 fw-semibold"
                style={{ cursor: 'pointer' }}
              >
                {editingId ? 'Guardar Cambios' : 'Crear Empresa'}
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
          <h5 className="text-white mb-3 fw-bold">Empresas bajo tu Administración</h5>
          
          {successMsg && (
            <div className="alert alert-success py-2 px-3 mb-3 border-0 rounded-3" style={{ fontSize: '0.85rem' }}>
              <FiCheck className="me-2" /> {successMsg}
            </div>
          )}

          {loading ? (
            <div className="text-center py-4">
              <div className="spinner-border text-primary" role="status"></div>
            </div>
          ) : empresas.length === 0 ? (
            <p className="text-muted mb-0">No se encontraron empresas registradas.</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-dark table-borderless table-dense align-middle mb-0">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <th>RAZÓN SOCIAL</th>
                    <th>RUC</th>
                    <th className="text-center">ESTADO</th>
                    <th className="text-center">ACCIONES</th>
                  </tr>
                </thead>
                <tbody>
                  {empresas.map(emp => (
                    <tr key={emp.id}>
                      <td className="text-white fw-semibold">{emp.razon_social}</td>
                      <td className="font-mono">{emp.ruc}</td>
                      <td className="text-center">
                        {emp.activo ? (
                          <span className="badge badge-status badge-status-ok">Activo</span>
                        ) : (
                          <span className="badge badge-status badge-status-error">Inactivo</span>
                        )}
                      </td>
                      <td className="text-center">
                        <button
                          onClick={() => handleEdit(emp)}
                          className="btn btn-sm btn-outline-warning me-1"
                          style={{ cursor: 'pointer' }}
                          title="Editar"
                        >
                          <FiEdit2 />
                        </button>
                        <button
                          onClick={() => handleDelete(emp.id)}
                          className="btn btn-sm btn-outline-danger"
                          style={{ cursor: 'pointer' }}
                          title="Eliminar"
                          disabled={emp.id === activeCompany.id} // Evitar eliminar la actual activa
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
