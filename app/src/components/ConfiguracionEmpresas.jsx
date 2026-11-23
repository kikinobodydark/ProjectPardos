import React, { useState, useMemo, memo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../utils/supabaseClient';
import {
  getOrCreateCsrfToken,
  verifyCsrfToken,
  checkRateLimit,
  sanitizeTextInput,
  logSuspiciousActivity,
} from '../utils/security';
import { COLS_EMPRESA } from '../utils/dbColumns';
import { clearPersistedQueryCache } from '../utils/queryPersister';
import { SkeletonTable } from './SkeletonLoader';
import { FiEdit2, FiTrash2, FiCheck, FiAlertTriangle, FiLock } from 'react-icons/fi';

const ConfiguracionEmpresas = memo(function ConfiguracionEmpresas({ activeCompany, userProfile }) {
  const queryClient = useQueryClient();
  const [csrfToken] = useState(() => getOrCreateCsrfToken());
  const isAdmin = userProfile?.rol === 'admin';

  // Formulario
  const [editingId, setEditingId] = useState(null);
  const [ruc, setRuc] = useState('');
  const [razonSocial, setRazonSocial] = useState('');
  const [activo, setActivo] = useState(true);

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [cleanSuccess, setCleanSuccess] = useState('');
  const [cleanError, setCleanError] = useState('');
  const [cleanLoading, setCleanLoading] = useState(false);

  const handleCleanActiveCompanyData = async () => {
    if (!isAdmin) {
      logSuspiciousActivity('INTENTO_VACIAR_EMPRESA_NO_ADMIN', { userId: userProfile?.id });
      return;
    }
    if (!verifyCsrfToken(csrfToken)) {
      setCleanError('Token CSRF inválido. Recarga la sesión.');
      return;
    }
    const rl = checkRateLimit('admin_clean_company_data', { maxAttempts: 3, windowMs: 60000, lockoutMs: 120000 });
    if (!rl.allowed) {
      setCleanError(rl.message);
      return;
    }
    if (!activeCompany?.id) {
      setCleanError('No hay una empresa activa seleccionada.');
      return;
    }

    const rucConfirm = window.prompt(
      `ACCIÓN DESTRUCTIVA IRREVERSIBLE\n\nSe eliminarán TODOS los períodos y comprobantes de Ventas y Compras únicamente de la empresa:\n${activeCompany.razon_social} (RUC ${activeCompany.ruc}).\n\nPara confirmar, escribe exactamente el RUC (${activeCompany.ruc}):`
    );
    if (rucConfirm === null) return;
    if (rucConfirm.trim() !== activeCompany.ruc) {
      setCleanError('Confirmación cancelada: el RUC ingresado no coincide con la empresa activa.');
      return;
    }

    setCleanLoading(true);
    setCleanSuccess('');
    setCleanError('');
    try {
      const { error } = await supabase
        .from('periodos_carga')
        .delete()
        .eq('empresa_id', activeCompany.id);

      if (error) throw error;

      await clearPersistedQueryCache();
      queryClient.invalidateQueries({ queryKey: ['periods'] });
      queryClient.invalidateQueries({ queryKey: ['cargaHistory'] });
      queryClient.invalidateQueries({ queryKey: ['ventasDocumentos'] });
      queryClient.invalidateQueries({ queryKey: ['comprasDocumentos'] });
      queryClient.invalidateQueries({ queryKey: ['reconciliation'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardStats'] });

      setCleanSuccess(
        `Se eliminaron todos los períodos y comprobantes de Ventas y Compras de ${activeCompany.razon_social} (${activeCompany.ruc}).`
      );
    } catch (err) {
      setCleanError(err.message || 'Ocurrió un error al limpiar la data de la empresa.');
    } finally {
      setCleanLoading(false);
    }
  };

  // Paginación de tabla de empresas
  const [pagina, setPagina] = useState(1);
  const porPagina = 10;

  // Comparte clave de caché con App.jsx y ConfiguracionUsuarios.jsx para evitar llamadas duplicadas
  const { data: empresas = [], isLoading, refetch } = useQuery({
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

  const totalPaginas = Math.ceil(empresas.length / porPagina);
  const empresasPaginadas = useMemo(
    () => empresas.slice((pagina - 1) * porPagina, pagina * porPagina),
    [empresas, pagina]
  );

  const resetForm = () => {
    setEditingId(null);
    setRuc('');
    setRazonSocial('');
    setActivo(true);
    setErrorMsg('');
  };

  const saveMutation = useMutation({
    mutationFn: async (payload) => {
      if (payload.id) {
        const { error } = await supabase
          .from('empresas')
          .update({
            ruc: payload.ruc,
            razon_social: payload.razonSocial,
            activo: payload.activo,
          })
          .eq('id', payload.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('empresas')
          .insert({
            ruc: payload.ruc,
            razon_social: payload.razonSocial,
            activo: true,
          });

        if (error) throw error;
      }
    },
    onSuccess: () => {
      setSuccessMsg(editingId ? 'Empresa actualizada correctamente.' : 'Empresa creada correctamente.');
      resetForm();
      refetch();
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    },
    onError: (err) => {
      setErrorMsg(err.message || 'Error al guardar empresa.');
    },
  });

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
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    },
    onError: (err) => {
      setErrorMsg(err.message || 'Error al eliminar empresa.');
    },
  });

  if (!isAdmin) {
    logSuspiciousActivity('RENDER_CONFIG_EMPRESAS_NO_ADMIN', { userId: userProfile?.id });
    return (
      <div className="card-premium p-4 text-center">
        <FiLock className="text-danger fs-2 mb-2" />
        <h5 className="fw-bold">Acceso Restringido</h5>
        <p className="text-muted mb-0">Solo los administradores activos pueden gestionar empresas.</p>
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

    const rl = checkRateLimit('admin_company_mutation', { maxAttempts: 10, windowMs: 60000, lockoutMs: 60000 });
    if (!rl.allowed) {
      setErrorMsg(rl.message);
      return;
    }

    const cleanRuc = ruc.trim();
    if (cleanRuc.length !== 11 || !/^(10|20)\d{9}$/.test(cleanRuc)) {
      setErrorMsg('El RUC debe tener exactamente 11 dígitos numéricos e iniciar con 10 o 20.');
      return;
    }

    const cleanRazonSocial = sanitizeTextInput(razonSocial, 180);
    if (cleanRazonSocial.length < 2) {
      setErrorMsg('La Razón Social debe tener al menos 2 caracteres válidos.');
      return;
    }

    saveMutation.mutate({
      id: editingId,
      ruc: cleanRuc,
      razonSocial: cleanRazonSocial,
      activo,
    });
  };

  const handleEdit = (emp) => {
    setEditingId(emp.id);
    setRuc(emp.ruc);
    setRazonSocial(emp.razon_social);
    setActivo(emp.activo);
  };

  const handleDelete = async (id) => {
    if (!verifyCsrfToken(csrfToken)) {
      setErrorMsg('Token CSRF inválido. Recarga la sesión.');
      return;
    }
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

          <form onSubmit={handleSubmit} autoComplete="off">
            <input type="hidden" name="csrf_token" value={csrfToken} readOnly />
            <div className="mb-3">
              <label className="form-label text-muted" style={{ fontSize: '0.8rem' }}>RUC</label>
              <input
                type="text"
                required
                disabled={editingId !== null}
                maxLength={11}
                className="form-control form-control-premium font-mono"
                placeholder="11 dígitos (10... o 20...)"
                value={ruc}
                onChange={(e) => setRuc(e.target.value)}
              />
            </div>

            <div className="mb-3">
              <label className="form-label text-muted" style={{ fontSize: '0.8rem' }}>Razón Social</label>
              <input
                type="text"
                required
                maxLength={180}
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
          <h5 className="mb-3 fw-bold">Empresas bajo tu Administración ({empresas.length})</h5>

          {successMsg && (
            <div className="alert alert-success py-2 px-3 mb-3 border-0 rounded-3" style={{ fontSize: '0.85rem' }}>
              <FiCheck className="me-2" /> {successMsg}
            </div>
          )}

          {loading ? (
            <SkeletonTable rows={5} columns={4} title="Cargando empresas..." />
          ) : empresas.length === 0 ? (
            <p className="text-muted mb-0">No se encontraron empresas registradas.</p>
          ) : (
            <>
              <div className="table-responsive">
                <table className="table table-hover table-dense align-middle mb-0">
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                      <th style={{ backgroundColor: 'var(--bg-surface)' }}>RAZÓN SOCIAL</th>
                      <th style={{ backgroundColor: 'var(--bg-surface)' }}>RUC</th>
                      <th className="text-center" style={{ backgroundColor: 'var(--bg-surface)' }}>ESTADO</th>
                      <th className="text-center" style={{ backgroundColor: 'var(--bg-surface)' }}>ACCIONES</th>
                    </tr>
                  </thead>
                  <tbody>
                    {empresasPaginadas.map((emp) => (
                      <tr key={emp.id}>
                        <td className="fw-semibold">{emp.razon_social}</td>
                        <td className="font-mono text-muted">{emp.ruc}</td>
                        <td className="text-center">
                          {emp.activo ? (
                            <span className="badge badge-status badge-status-ok">Activo</span>
                          ) : (
                            <span className="badge badge-status badge-status-error">Inactivo</span>
                          )}
                        </td>
                        <td className="text-center">
                          <button
                            type="button"
                            onClick={() => handleEdit(emp)}
                            className="btn btn-sm btn-outline-warning me-1"
                            style={{ cursor: 'pointer' }}
                            title="Editar"
                          >
                            <FiEdit2 />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(emp.id)}
                            className="btn btn-sm btn-outline-danger"
                            style={{ cursor: 'pointer' }}
                            title="Eliminar"
                            disabled={emp.id === activeCompany?.id}
                          >
                            <FiTrash2 />
                          </button>
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

      {/* Herramientas de Mantenimiento */}
      <div className="col-12 mt-4">
        <div className="card-premium p-4">
          <h5 className="mb-2 fw-bold" style={{ color: 'var(--color-text)' }}>Mantenimiento y Calidad de Datos</h5>
          <p className="text-muted mb-3" style={{ fontSize: '0.88rem' }}>
            Acciones administrativas acotadas a la empresa activa para garantizar aislamiento de datos.
          </p>

          {cleanSuccess && (
            <div className="alert alert-success py-2 px-3 mb-3 border-0 rounded-3 animate-fade-in" style={{ fontSize: '0.85rem' }}>
              <FiCheck className="me-2" /> {cleanSuccess}
            </div>
          )}

          {cleanError && (
            <div className="alert alert-danger py-2 px-3 mb-3 border-0 rounded-3 animate-fade-in" style={{ fontSize: '0.85rem' }}>
              <FiAlertTriangle className="me-2" /> {cleanError}
            </div>
          )}

          <div
            className="d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between p-3 rounded-3 gap-3"
            style={{ backgroundColor: 'rgba(220, 38, 38, 0.05)', border: '1px solid rgba(220, 38, 38, 0.2)' }}
          >
            <div>
              <h6 className="fw-bold mb-1 text-danger">
                Limpiar Data de Ventas y Compras — {activeCompany?.razon_social || 'Empresa Activa'}
              </h6>
              <small className="text-muted">
                Elimina únicamente los períodos cargados y sus comprobantes en <strong>detalle_ventas</strong> y <strong>detalle_compras</strong> de la empresa seleccionada (RUC <strong>{activeCompany?.ruc || '—'}</strong>). Requiere confirmar escribiendo el RUC.
              </small>
            </div>
            <button
              type="button"
              onClick={handleCleanActiveCompanyData}
              disabled={cleanLoading || !activeCompany?.id}
              className="btn btn-danger px-4 py-2 rounded-3 fw-bold d-flex align-items-center"
              style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              <FiTrash2 className="me-2" />
              {cleanLoading ? 'Eliminando data...' : 'Vaciar Empresa Activa'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

export default ConfiguracionEmpresas;
