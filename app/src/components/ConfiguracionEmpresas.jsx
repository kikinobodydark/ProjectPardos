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
import { executeParallelBatches } from '../utils/jobQueue';
import { fetchAllSupabasePages, SUPABASE_MAX_SELECT_ROWS } from '../utils/supabasePagination';
import { clearPersistedQueryCache } from '../utils/queryPersister';
import { SkeletonTable } from './SkeletonLoader';
import { FiEdit2, FiTrash2, FiCheck, FiAlertTriangle, FiLock } from 'react-icons/fi';
import { isValidIdentityNumber, isRecordAnulado } from '../utils/validations';

const COLS_EMPRESA = 'id, ruc, razon_social, activo, estudio_id';
const COLS_REVALIDACION = [
  'id',
  'tipo_identidad_sap',
  'nro_identidad_sap',
  'nombre_sap',
  'tipo_identidad_sunat',
  'nro_identidad_sunat',
  'nombre_sunat',
  'base_sap',
  'igv_sap',
  'total_sap',
  'base_sunat',
  'igv_sunat',
  'total_sunat',
  'exonerado_sap',
  'exonerado_sunat',
  'inafecto_sap',
  'inafecto_sunat',
  'otros_sap',
  'otros_sunat',
  'estado_validacion',
  'errores_json',
].join(',');

const ConfiguracionEmpresas = memo(function ConfiguracionEmpresas({ activeCompany, userProfile }) {
  const queryClient = useQueryClient();
  const [csrfToken] = useState(() => getOrCreateCsrfToken());
  const isAdmin = !userProfile || userProfile?.rol === 'admin';

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
  const [cleanLoading, setCleanLoading] = useState(false);

  const handleCleanAllModulesData = async () => {
    if (!verifyCsrfToken(csrfToken)) {
      setRevalError('Token CSRF inválido. Recarga la sesión.');
      return;
    }
    const ok = window.confirm(
      '¿Estás seguro de que deseas eliminar TODA la data de los módulos de Ventas y Compras (todas las cargas y comprobantes) para comenzar de nuevo? Las empresas y usuarios se conservarán.'
    );
    if (!ok) return;

    setCleanLoading(true);
    setRevalSuccess('');
    setRevalError('');
    try {
      const { error } = await supabase
        .from('periodos_carga')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');

      if (error) throw error;

      await clearPersistedQueryCache();
      queryClient.invalidateQueries({ queryKey: ['periods'] });
      queryClient.invalidateQueries({ queryKey: ['cargaHistory'] });
      queryClient.invalidateQueries({ queryKey: ['ventasDocumentos'] });
      queryClient.invalidateQueries({ queryKey: ['reconciliation'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardStats'] });

      setRevalSuccess('Se eliminaron todos los períodos y comprobantes de los módulos de Ventas y Compras correctamente.');
    } catch (err) {
      setRevalError(err.message || 'Ocurrió un error al limpiar la data de los módulos.');
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

  /**
   * Revalidación optimizada:
   * 1. Pide solo las columnas necesarias (COLS_REVALIDACION)
   * 2. Descarga detalle_ventas y detalle_compras en paralelo
   * 3. Elimina las consultas N+1 agrupando actualizaciones en la cola de trabajo en paralelo
   */
  const handleRevalidateAll = async () => {
    if (!verifyCsrfToken(csrfToken)) {
      setRevalError('Token CSRF inválido. Recarga la sesión.');
      return;
    }
    const rl = checkRateLimit('revalidate_all', { maxAttempts: 2, windowMs: 60000, lockoutMs: 60000 });
    if (!rl.allowed) {
      setRevalError(rl.message);
      return;
    }

    setRevalLoading(true);
    setRevalSuccess('');
    setRevalError('');
    try {
      const fetchTableRows = (tableName) =>
        fetchAllSupabasePages({
          pageSize: SUPABASE_MAX_SELECT_ROWS,
          concurrency: 4,
          label: `RevalFetch_${tableName}`,
          fetchPage: (from, to, withCount) =>
            supabase
              .from(tableName)
              .select(COLS_REVALIDACION, withCount ? { count: 'exact' } : undefined)
              .order('id', { ascending: true })
              .range(from, to),
        });

      // Descargar ambas tablas en paralelo
      const [ventasRows, comprasRows] = await Promise.all([
        fetchTableRows('detalle_ventas'),
        fetchTableRows('detalle_compras'),
      ]);

      let totalAnalyzed = ventasRows.length + comprasRows.length;
      const updatesToRun = [];

      const evaluateTable = (tableName, rows) => {
        for (const row of rows) {
          const errors = [...(row.errores_json || [])];
          if (errors.some((e) => e && typeof e === 'object')) {
            continue;
          }

          const cleanErrors = errors.filter(
            (e) =>
              typeof e === 'string' &&
              !e.startsWith('OBS 6:') &&
              !e.startsWith('Identidad SAP no cumple') &&
              !e.startsWith('OBS 7:') &&
              !e.startsWith('Identidad SUNAT no cumple')
          );

          const isNoExisteSAP = row.nro_identidad_sap === null && row.nombre_sap === null;
          if (!isNoExisteSAP && row.tipo_identidad_sap !== null && row.nro_identidad_sap !== null) {
            if (!isValidIdentityNumber(row.tipo_identidad_sap, row.nro_identidad_sap)) {
              if (tableName === 'detalle_compras') {
                cleanErrors.push('OBS 6: RUC PROVEEDOR INVÁLIDO (SAP)');
              } else {
                cleanErrors.push('OBS 6: NÚMERO DE IDENTIDAD SAP INCORRECTO');
                cleanErrors.push(`Identidad SAP no cumple con longitud/formato para tipo ${row.tipo_identidad_sap}: ${row.nro_identidad_sap}`);
              }
            }
          }

          const isNoExisteSUNAT = row.nro_identidad_sunat === null && row.nombre_sunat === null;
          if (!isNoExisteSUNAT && row.tipo_identidad_sunat !== null && row.nro_identidad_sunat !== null) {
            if (!isValidIdentityNumber(row.tipo_identidad_sunat, row.nro_identidad_sunat)) {
              if (tableName === 'detalle_compras') {
                cleanErrors.push('OBS 7: RUC PROVEEDOR INVÁLIDO (SUNAT)');
              } else {
                cleanErrors.push('OBS 7: NÚMERO DE IDENTIDAD SUNAT INCORRECTO');
                cleanErrors.push(`Identidad SUNAT no cumple con longitud/formato para tipo ${row.tipo_identidad_sunat}: ${row.nro_identidad_sunat}`);
              }
            }
          }

          const isAnulado = isRecordAnulado(row);
          let newStatus = 'OK';

          if (!isAnulado) {
            const hasError = cleanErrors.some((e) => e.startsWith('ERROR '));
            const hasObs = cleanErrors.some((e) => e.startsWith('OBS ') || e.startsWith('SIRE Alerta') || e.startsWith('SIRE:'));
            if (hasError) newStatus = 'ERROR';
            else if (hasObs) newStatus = 'OBSERVADO';
          }

          const statusChanged = row.estado_validacion !== newStatus;
          const errorsChanged = JSON.stringify(row.errores_json || []) !== JSON.stringify(cleanErrors);

          if (statusChanged || errorsChanged) {
            updatesToRun.push({
              tableName,
              id: row.id,
              estado_validacion: newStatus,
              errores_json: cleanErrors,
            });
          }
        }
      };

      evaluateTable('detalle_ventas', ventasRows);
      evaluateTable('detalle_compras', comprasRows);

      // Ejecutar actualizaciones en paralelo controlado mediante la cola de trabajo (sin bloqueo secuencial N+1)
      if (updatesToRun.length > 0) {
        await executeParallelBatches(
          updatesToRun,
          25,
          async (batch) => {
            await Promise.all(
              batch.map((u) =>
                supabase
                  .from(u.tableName)
                  .update({ estado_validacion: u.estado_validacion, errores_json: u.errores_json })
                  .eq('id', u.id)
                  .then(({ error }) => {
                    if (error) throw error;
                  })
              )
            );
          },
          { concurrency: 4, label: 'RevalidateBatch' }
        );
      }

      setRevalSuccess(
        `Revalidación completada. Se analizaron ${totalAnalyzed} registros en paralelo y se actualizaron ${updatesToRun.length} con discrepancias de identidad.`
      );
    } catch (err) {
      setRevalError(err.message || 'Ocurrió un error al revalidar los registros.');
    } finally {
      setRevalLoading(false);
    }
  };

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

          <div
            className="d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between p-3 rounded-3 gap-3"
            style={{ backgroundColor: 'rgba(241, 245, 249, 0.7)', border: '1px solid var(--border-color)' }}
          >
            <div>
              <h6 className="fw-bold mb-1" style={{ color: 'var(--color-text)' }}>Revalidación Masiva de Números de Identidad</h6>
              <small className="text-muted">
                Vuelve a evaluar todos los registros históricos de SAP y SUNAT contra la longitud de dígitos correcta de DNI (8), RUC (11) y CE (9).
              </small>
            </div>
            <button
              type="button"
              onClick={handleRevalidateAll}
              disabled={revalLoading || cleanLoading}
              className="btn btn-warning px-4 py-2 rounded-3 fw-bold d-flex align-items-center"
              style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              {revalLoading ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                  Procesando en lotes...
                </>
              ) : (
                'Revalidar Historial'
              )}
            </button>
          </div>

          <div
            className="d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between p-3 rounded-3 gap-3 mt-3"
            style={{ backgroundColor: 'rgba(220, 38, 38, 0.05)', border: '1px solid rgba(220, 38, 38, 0.2)' }}
          >
            <div>
              <h6 className="fw-bold mb-1 text-danger">Limpiar Toda la Data de Ventas y Compras</h6>
              <small className="text-muted">
                Elimina todos los períodos cargados y sus comprobantes en <strong>detalle_ventas</strong> y <strong>detalle_compras</strong> (conservando empresas y usuarios) para comenzar de nuevo desde cero.
              </small>
            </div>
            <button
              type="button"
              onClick={handleCleanAllModulesData}
              disabled={cleanLoading || revalLoading}
              className="btn btn-danger px-4 py-2 rounded-3 fw-bold d-flex align-items-center"
              style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              <FiTrash2 className="me-2" />
              {cleanLoading ? 'Eliminando data...' : 'Vaciar Ventas y Compras'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

export default ConfiguracionEmpresas;
