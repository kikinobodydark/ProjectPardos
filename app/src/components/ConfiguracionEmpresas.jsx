import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '../utils/supabaseClient';
import { FiPlus, FiEdit2, FiTrash2, FiCheck, FiX, FiAlertTriangle } from 'react-icons/fi';
import { isValidIdentityNumber, isRecordAnulado } from '../utils/validations';

export default function ConfiguracionEmpresas({ activeCompany }) {
  // Formulario
  const [editingId, setEditingId] = useState(null);
  const [ruc, setRuc] = useState('');
  const [razonSocial, setRazonSocial] = useState('');
  const [activo, setActivo] = useState(true);
  
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [revalLoading, setRevalLoading] = useState(false);
  const [revalSuccess, setRevalSuccess] = useState('');
  const [revalError, setRevalError] = useState('');

  const handleRevalidateAll = async () => {
    setRevalLoading(true);
    setRevalSuccess('');
    setRevalError('');
    try {
      let allRows = [];
      let page = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('detalle_validacion')
          .select('*')
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) throw error;
        if (!data || data.length === 0) {
          hasMore = false;
        } else {
          allRows = allRows.concat(data);
          if (data.length < pageSize) {
            hasMore = false;
          } else {
            page++;
          }
        }
      }

      if (allRows.length === 0) {
        setRevalSuccess('No hay registros para revalidar.');
        setRevalLoading(false);
        return;
      }

      let updatedCount = 0;
      for (const row of allRows) {
        const errors = [...(row.errores_json || [])];

        const cleanErrors = errors.filter(e => 
          !e.startsWith('OBS 6:') && 
          !e.startsWith('Identidad SAP no cumple') &&
          !e.startsWith('OBS 7:') && 
          !e.startsWith('Identidad SUNAT no cumple')
        );

        const isNoExisteSAP = row.nro_identidad_sap === null && row.nombre_sap === null;
        if (!isNoExisteSAP && row.tipo_identidad_sap !== null && row.nro_identidad_sap !== null) {
          if (!isValidIdentityNumber(row.tipo_identidad_sap, row.nro_identidad_sap)) {
            cleanErrors.push("OBS 6: NÚMERO DE IDENTIDAD SAP INCORRECTO");
            cleanErrors.push(`Identidad SAP no cumple con longitud/formato para tipo ${row.tipo_identidad_sap}: ${row.nro_identidad_sap}`);
          }
        }

        const isNoExisteSUNAT = row.nro_identidad_sunat === null && row.nombre_sunat === null;
        if (!isNoExisteSUNAT && row.tipo_identidad_sunat !== null && row.nro_identidad_sunat !== null) {
          if (!isValidIdentityNumber(row.tipo_identidad_sunat, row.nro_identidad_sunat)) {
            cleanErrors.push("OBS 7: NÚMERO DE IDENTIDAD SUNAT INCORRECTO");
            cleanErrors.push(`Identidad SUNAT no cumple con longitud/formato para tipo ${row.tipo_identidad_sunat}: ${row.nro_identidad_sunat}`);
          }
        }

        const isAnulado = isRecordAnulado(row);
        let newStatus = 'OK';
        
        if (isAnulado) {
          newStatus = 'OK';
        } else {
          const hasError = cleanErrors.some(e => e.startsWith('ERROR '));
          const hasObs = cleanErrors.some(e => e.startsWith('OBS ') || e.startsWith('SIRE Alerta') || e.startsWith('SIRE:'));
          if (hasError) {
            newStatus = 'ERROR';
          } else if (hasObs) {
            newStatus = 'OBSERVADO';
          } else {
            newStatus = 'OK';
          }
        }

        const statusChanged = row.estado_validacion !== newStatus;
        const oldJsonStr = JSON.stringify(row.errores_json || []);
        const newJsonStr = JSON.stringify(cleanErrors);
        const errorsChanged = oldJsonStr !== newJsonStr;

        if (statusChanged || errorsChanged) {
          const { error: updateErr } = await supabase
            .from('detalle_validacion')
            .update({
              estado_validacion: newStatus,
              errores_json: cleanErrors
            })
            .eq('id', row.id);

          if (updateErr) throw updateErr;
          updatedCount++;
        }
      }

      setRevalSuccess(`Revalidación completada. Se analizaron ${allRows.length} registros y se actualizaron ${updatedCount} con discrepancias de formato de identidad.`);
    } catch (err) {
      console.error(err);
      setRevalError(err.message || 'Ocurrió un error al revalidar los registros.');
    } finally {
      setRevalLoading(false);
    }
  };

  // TanStack Query para obtener la lista de empresas
  const { data: empresas = [], isLoading, refetch } = useQuery({
    queryKey: ['empresas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('empresas')
        .select('*')
        .order('razon_social', { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const resetForm = () => {
    setEditingId(null);
    setRuc('');
    setRazonSocial('');
    setActivo(true);
    setErrorMsg('');
  };

  // TanStack Mutation para guardar/crear empresa
  const saveMutation = useMutation({
    mutationFn: async (payload) => {
      if (payload.id) {
        // Actualizar empresa
        const { error } = await supabase
          .from('empresas')
          .update({
            ruc: payload.ruc,
            razon_social: payload.razonSocial,
            activo: payload.activo
          })
          .eq('id', payload.id);

        if (error) throw error;
      } else {
        // Crear empresa
        const { error } = await supabase
          .from('empresas')
          .insert({
            ruc: payload.ruc,
            razon_social: payload.razonSocial,
            activo: true
          });

        if (error) throw error;
      }
    },
    onSuccess: () => {
      setSuccessMsg(editingId ? 'Empresa actualizada correctamente.' : 'Empresa creada correctamente.');
      resetForm();
      refetch();
    },
    onError: (err) => {
      setErrorMsg(err.message || 'Error al guardar empresa.');
    }
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (ruc.length !== 11 || !/^\d+$/.test(ruc)) {
      setErrorMsg('El RUC debe tener exactamente 11 caracteres numéricos.');
      return;
    }

    saveMutation.mutate({
      id: editingId,
      ruc,
      razonSocial,
      activo
    });
  };

  const handleEdit = (emp) => {
    setEditingId(emp.id);
    setRuc(emp.ruc);
    setRazonSocial(emp.razon_social);
    setActivo(emp.activo);
  };

  // TanStack Mutation para eliminar empresa
  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('empresas')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      setSuccessMsg('Empresa eliminada correctamente.');
      refetch();
    },
    onError: (err) => {
      setErrorMsg(err.message || 'Error al eliminar empresa.');
    }
  });

  const handleDelete = async (id) => {
    if (!window.confirm('¿Estás seguro de que deseas eliminar esta empresa? Todos los datos relacionados se perderán.')) return;
    
    setErrorMsg('');
    setSuccessMsg('');
    deleteMutation.mutate(id);
  };

  const loading = isLoading || saveMutation.isPending || deleteMutation.isPending;

  return (
    <div className="row g-4 animate-fade-in">
      <div className="col-lg-5">
        <div className="card-premium">
          <h5 className="mb-3 fw-bold">
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
                <label htmlFor="activo" className="form-check-label" style={{ fontSize: '0.85rem' }}>Empresa Activa</label>
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
          <h5 className="mb-3 fw-bold">Empresas bajo tu Administración</h5>
          
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
                      <td className="fw-semibold">{emp.razon_social}</td>
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

      {/* Herramientas de Mantenimiento (Solo Admins) */}
      <div className="col-12 mt-4">
        <div className="card-premium">
          <h5 className="mb-2 fw-bold">Mantenimiento y Calidad de Datos</h5>
          <p className="text-muted mb-3" style={{ fontSize: '0.88rem' }}>
            Ejecuta diagnósticos y actualizaciones masivas en los registros de conciliación.
          </p>

          {revalSuccess && (
            <div className="alert alert-success py-2 px-3 mb-3 border-0 rounded-3 animate-fade-in" style={{ fontSize: '0.85rem' }}>
              <FiCheck className="me-2" /> {revalSuccess}
            </div>
          )}

          {revalError && (
            <div className="alert alert-danger py-2 px-3 mb-3 border-0 rounded-3 animate-fade-in" style={{ fontSize: '0.85rem' }}>
              <FiAlertTriangle className="me-2" /> {revalError}
            </div>
          )}

          <div className="d-flex align-items-center justify-content-between p-3 rounded-3 bg-dark bg-opacity-25 border border-secondary border-opacity-10">
            <div className="me-3">
              <h6 className="fw-bold mb-1 text-white">Revalidación Masiva de Números de Identidad</h6>
              <small className="text-muted">
                Vuelve a evaluar todos los registros históricos de SAP y SUNAT contra la longitud de dígitos correcta de DNI (8), RUC (11) y CE (9).
              </small>
            </div>
            <button
              onClick={handleRevalidateAll}
              disabled={revalLoading}
              className="btn btn-warning px-4 py-2 rounded-3 fw-semibold d-flex align-items-center"
              style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              {revalLoading ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                  Procesando...
                </>
              ) : (
                'Revalidar Historial'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
