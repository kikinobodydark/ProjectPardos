// ============================================================================
// Configuración de Locales y Series por Empresa (Módulo Administración)
// Permite crear, editar y eliminar locales de cada empresa, así como agregar,
// actualizar o quitar sus series de Factura (01), Boleta (03), Nota de Crédito
// (07) y Nota de Débito (08). Al guardar se actualizan los filtros en vivo.
// ============================================================================
import React, { useState, useEffect, useMemo, memo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../utils/supabaseClient';
import {
  getOrCreateCsrfToken,
  verifyCsrfToken,
  checkRateLimit,
  sanitizeTextInput,
  logSuspiciousActivity,
} from '../utils/security';
import {
  useLocalesEmpresa,
  TIPOS_SERIE_LOCAL,
  normalizarSerie,
} from '../utils/useLocalesEmpresa';
import { SkeletonTable } from './SkeletonLoader';
import {
  FiMapPin, FiPlus, FiEdit2, FiTrash2, FiCheck, FiAlertTriangle, FiLock, FiX,
} from 'react-icons/fi';

const EMPTY_SERIES = { '01': [], '03': [], '07': [], '08': [] };
const EMPTY_INPUTS = { '01': '', '03': '', '07': '', '08': '' };

const ConfiguracionLocales = memo(function ConfiguracionLocales({
  activeCompany,
  companies = [],
  userProfile,
}) {
  const queryClient = useQueryClient();
  const [csrfToken] = useState(() => getOrCreateCsrfToken());
  const isAdmin = !userProfile || userProfile?.rol === 'admin';

  const [selectedEmpresaId, setSelectedEmpresaId] = useState(
    () => activeCompany?.id || companies[0]?.id || ''
  );

  useEffect(() => {
    if (!selectedEmpresaId && (activeCompany?.id || companies[0]?.id)) {
      setSelectedEmpresaId(activeCompany?.id || companies[0]?.id || '');
    }
  }, [activeCompany?.id, companies, selectedEmpresaId]);

  const { locales, isLoading, refetch } = useLocalesEmpresa(selectedEmpresaId, isAdmin);

  // Estado del formulario
  const [editingId, setEditingId] = useState(null);
  const [nombre, setNombre] = useState('');
  const [activo, setActivo] = useState(true);
  const [seriesPorTipo, setSeriesPorTipo] = useState(EMPTY_SERIES);
  const [serieInputs, setSerieInputs] = useState(EMPTY_INPUTS);

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const empresaSeleccionada = useMemo(
    () => companies.find((c) => c.id === selectedEmpresaId) || activeCompany || null,
    [companies, selectedEmpresaId, activeCompany]
  );

  const resetForm = () => {
    setEditingId(null);
    setNombre('');
    setActivo(true);
    setSeriesPorTipo({ '01': [], '03': [], '07': [], '08': [] });
    setSerieInputs({ '01': '', '03': '', '07': '', '08': '' });
    setErrorMsg('');
  };

  const handleEmpresaChange = (newEmpId) => {
    setSelectedEmpresaId(newEmpId);
    resetForm();
    setSuccessMsg('');
  };

  /** Agrega una o varias series separadas por coma/espacio al tipo indicado. */
  const agregarSeriesATipo = (tipo, rawValue) => {
    const tokens = String(rawValue ?? '')
      .split(/[\s,;]+/)
      .map(normalizarSerie)
      .filter((s) => s.length >= 2);
    if (tokens.length === 0) return;

    setSeriesPorTipo((prev) => {
      const actuales = new Set(prev[tipo] || []);
      for (const tok of tokens) actuales.add(tok);
      return {
        ...prev,
        [tipo]: [...actuales].sort((a, b) => a.localeCompare(b)),
      };
    });
    setSerieInputs((prev) => ({ ...prev, [tipo]: '' }));
    setErrorMsg('');
  };

  const quitarSerieDeTipo = (tipo, serie) => {
    setSeriesPorTipo((prev) => ({
      ...prev,
      [tipo]: (prev[tipo] || []).filter((s) => s !== serie),
    }));
  };

  const handleEdit = (loc) => {
    setEditingId(loc.id);
    setNombre(loc.nombre);
    setActivo(loc.activo !== false);
    setSeriesPorTipo({
      '01': [...(loc.seriesPorTipo['01'] || [])],
      '03': [...(loc.seriesPorTipo['03'] || [])],
      '07': [...(loc.seriesPorTipo['07'] || [])],
      '08': [...(loc.seriesPorTipo['08'] || [])],
    });
    setSerieInputs({ '01': '', '03': '', '07': '', '08': '' });
    setErrorMsg('');
    setSuccessMsg('');
  };

  const saveMutation = useMutation({
    mutationFn: async (payload) => {
      let localId = payload.id;

      if (localId) {
        const { error: updErr } = await supabase
          .from('locales_empresa')
          .update({
            nombre: payload.nombre,
            activo: payload.activo,
            updated_at: new Date().toISOString(),
          })
          .eq('id', localId);
        if (updErr) throw updErr;

        // Reemplazar las series del local para reflejar adiciones, ediciones y eliminaciones
        const { error: delErr } = await supabase
          .from('local_series')
          .delete()
          .eq('local_id', localId);
        if (delErr) throw delErr;
      } else {
        const { data: inserted, error: insErr } = await supabase
          .from('locales_empresa')
          .insert({
            empresa_id: payload.empresaId,
            nombre: payload.nombre,
            activo: true,
          })
          .select('id')
          .single();
        if (insErr) throw insErr;
        localId = inserted.id;
      }

      if (payload.seriesRows.length > 0) {
        const rows = payload.seriesRows.map((s) => ({
          local_id: localId,
          empresa_id: payload.empresaId,
          tipo_doc_pago: s.tipo_doc_pago,
          serie: s.serie,
        }));
        const { error: serErr } = await supabase.from('local_series').insert(rows);
        if (serErr) throw serErr;
      }
    },
    onSuccess: () => {
      setSuccessMsg(
        editingId
          ? 'Local y series actualizados correctamente. Los filtros ya reflejan los cambios.'
          : 'Local creado correctamente. Ya está disponible en los filtros de la empresa.'
      );
      resetForm();
      refetch();
      queryClient.invalidateQueries({ queryKey: ['localesEmpresa', selectedEmpresaId] });
      queryClient.invalidateQueries({ queryKey: ['localesEmpresa'] });
    },
    onError: (err) => {
      const msg = err?.message || 'Error al guardar el local.';
      if (msg.includes('uq_local_series_empresa_tipo_serie')) {
        setErrorMsg('Una de las series ingresadas ya pertenece a otro local de esta empresa.');
      } else if (msg.includes('uq_locales_empresa_empresa_nombre')) {
        setErrorMsg('Ya existe un local con ese nombre en esta empresa.');
      } else {
        setErrorMsg(msg);
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (localId) => {
      const { error } = await supabase.from('locales_empresa').delete().eq('id', localId);
      if (error) throw error;
    },
    onSuccess: (_data, deletedId) => {
      if (editingId === deletedId) resetForm();
      setSuccessMsg('Local eliminado correctamente. Los filtros fueron actualizados.');
      refetch();
      queryClient.invalidateQueries({ queryKey: ['localesEmpresa', selectedEmpresaId] });
      queryClient.invalidateQueries({ queryKey: ['localesEmpresa'] });
    },
    onError: (err) => {
      setErrorMsg(err?.message || 'Error al eliminar el local.');
    },
  });

  if (!isAdmin) {
    logSuspiciousActivity('RENDER_CONFIG_LOCALES_NO_ADMIN', { userId: userProfile?.id });
    return (
      <div className="card-premium p-4 text-center">
        <FiLock className="text-danger fs-2 mb-2" />
        <h5 className="fw-bold">Acceso Restringido</h5>
        <p className="text-muted mb-0">Solo los administradores activos pueden configurar locales y series.</p>
      </div>
    );
  }

  const handleSubmit = (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!verifyCsrfToken(csrfToken)) {
      setErrorMsg('Token CSRF inválido. Recarga la sesión.');
      return;
    }

    const rl = checkRateLimit('admin_local_mutation', { maxAttempts: 20, windowMs: 60000, lockoutMs: 60000 });
    if (!rl.allowed) {
      setErrorMsg(rl.message);
      return;
    }

    if (!selectedEmpresaId) {
      setErrorMsg('Selecciona una empresa primero.');
      return;
    }

    const cleanNombre = sanitizeTextInput(nombre, 120);
    if (cleanNombre.length < 2) {
      setErrorMsg('El nombre del local debe tener al menos 2 caracteres.');
      return;
    }

    // Incorporar automáticamente cualquier texto que haya quedado escrito sin presionar Enter
    const mergedSeries = {
      '01': [...(seriesPorTipo['01'] || [])],
      '03': [...(seriesPorTipo['03'] || [])],
      '07': [...(seriesPorTipo['07'] || [])],
      '08': [...(seriesPorTipo['08'] || [])],
    };
    for (const t of TIPOS_SERIE_LOCAL) {
      const extra = String(serieInputs[t.codigo] || '')
        .split(/[\s,;]+/)
        .map(normalizarSerie)
        .filter((s) => s.length >= 2);
      if (extra.length > 0) {
        mergedSeries[t.codigo] = [...new Set([...mergedSeries[t.codigo], ...extra])];
      }
    }

    const seriesRows = [];
    for (const t of TIPOS_SERIE_LOCAL) {
      for (const s of mergedSeries[t.codigo]) {
        seriesRows.push({ tipo_doc_pago: t.codigo, serie: s });
      }
    }

    if (seriesRows.length === 0) {
      setErrorMsg('Debes asignar al menos una serie (Factura, Boleta o Nota de Crédito/Débito) al local.');
      return;
    }

    // Validar conflictos contra otros locales de la misma empresa antes de enviar
    for (const loc of locales) {
      if (loc.id === editingId) continue;
      if (loc.nombre.trim().toLowerCase() === cleanNombre.toLowerCase()) {
        setErrorMsg(`Ya existe el local "${loc.nombre}" en esta empresa.`);
        return;
      }
      for (const sr of seriesRows) {
        if (loc.clavesTipoSerie.has(`${sr.tipo_doc_pago}|${sr.serie}`)) {
          setErrorMsg(`La serie ${sr.serie} ya está asignada al local "${loc.nombre}". Quítala primero de ese local.`);
          return;
        }
      }
    }

    saveMutation.mutate({
      id: editingId,
      empresaId: selectedEmpresaId,
      nombre: cleanNombre,
      activo,
      seriesRows,
    });
  };

  const handleDelete = (loc) => {
    if (!verifyCsrfToken(csrfToken)) {
      setErrorMsg('Token CSRF inválido. Recarga la sesión.');
      return;
    }
    if (!window.confirm(`¿Deseas eliminar el local "${loc.nombre}" y sus series configuradas?`)) return;
    setErrorMsg('');
    setSuccessMsg('');
    deleteMutation.mutate(loc.id);
  };

  const busy = isLoading || saveMutation.isPending || deleteMutation.isPending;

  return (
    <div className="animate-fade-in">
      {/* Selector de Empresa */}
      <div className="card-premium mb-4 p-3">
        <div className="d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-3">
          <div className="d-flex align-items-center gap-2">
            <div
              className="rounded-3 d-flex align-items-center justify-content-center"
              style={{ width: '40px', height: '40px', backgroundColor: 'rgba(37, 99, 235, 0.1)', color: '#2563EB', fontSize: '1.2rem' }}
            >
              <FiMapPin />
            </div>
            <div>
              <h5 className="mb-0 fw-bold">Configuración de Locales y Series por Empresa</h5>
              <small className="text-muted">
                Asigna las series de Facturas, Boletas y Notas de Crédito/Débito a cada local para habilitar el filtro por local.
              </small>
            </div>
          </div>

          <div style={{ minWidth: '280px' }}>
            <label className="form-label text-muted mb-1" style={{ fontSize: '0.75rem', fontWeight: 600 }}>
              EMPRESA A CONFIGURAR
            </label>
            <select
              className="form-select form-control-premium fw-semibold"
              value={selectedEmpresaId}
              onChange={(e) => handleEmpresaChange(e.target.value)}
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.razon_social} ({c.ruc})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="row g-4">
        {/* Formulario Agregar / Editar Local */}
        <div className="col-lg-5">
          <div className="card-premium">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h5 className="mb-0 fw-bold">
                {editingId ? 'Editar Local y Series' : 'Agregar Nuevo Local'}
              </h5>
              {editingId && (
                <span className="badge badge-status badge-status-observado">Editando</span>
              )}
            </div>

            {errorMsg && (
              <div className="alert alert-danger py-2 px-3 mb-3 border-0 rounded-3" style={{ fontSize: '0.84rem' }}>
                <FiAlertTriangle className="me-2" /> {errorMsg}
              </div>
            )}

            <form onSubmit={handleSubmit} autoComplete="off">
              <input type="hidden" name="csrf_token" value={csrfToken} readOnly />

              <div className="mb-3">
                <label className="form-label text-muted fw-semibold" style={{ fontSize: '0.78rem' }}>
                  Nombre del Local
                </label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  className="form-control form-control-premium"
                  placeholder="Ej: Mr Shao Megaplaza"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                />
              </div>

              {TIPOS_SERIE_LOCAL.map((t) => {
                const lista = seriesPorTipo[t.codigo] || [];
                const valInput = serieInputs[t.codigo] || '';
                return (
                  <div className="mb-3" key={t.codigo}>
                    <label className="form-label text-muted fw-semibold mb-1" style={{ fontSize: '0.78rem' }}>
                      {t.label} <span className="font-mono text-muted">({t.codigo})</span>
                    </label>
                    <div className="input-group input-group-sm mb-1">
                      <input
                        type="text"
                        className="form-control form-control-premium font-mono"
                        placeholder={t.placeholder}
                        value={valInput}
                        onChange={(e) =>
                          setSerieInputs((prev) => ({ ...prev, [t.codigo]: e.target.value.toUpperCase() }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ',') {
                            e.preventDefault();
                            agregarSeriesATipo(t.codigo, valInput);
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-outline-primary d-flex align-items-center px-2.5 fw-semibold"
                        onClick={() => agregarSeriesATipo(t.codigo, valInput)}
                        title="Agregar serie"
                      >
                        <FiPlus className="me-1" /> Agregar
                      </button>
                    </div>
                    {lista.length > 0 ? (
                      <div className="d-flex flex-wrap gap-1 mt-1">
                        {lista.map((serie) => (
                          <span
                            key={`${t.codigo}-${serie}`}
                            className="badge font-mono d-inline-flex align-items-center gap-1 py-1 px-2"
                            style={{
                              backgroundColor:
                                t.codigo === '01'
                                  ? 'rgba(37, 99, 235, 0.1)'
                                  : t.codigo === '03'
                                    ? 'rgba(5, 150, 105, 0.1)'
                                    : 'rgba(217, 119, 6, 0.12)',
                              color:
                                t.codigo === '01'
                                  ? '#1D4ED8'
                                  : t.codigo === '03'
                                    ? '#047857'
                                    : '#B45309',
                              border: '1px solid rgba(148, 163, 184, 0.35)',
                              fontSize: '0.76rem',
                            }}
                          >
                            <span>{serie}</span>
                            <button
                              type="button"
                              className="border-0 bg-transparent p-0 d-inline-flex align-items-center"
                              style={{ color: 'inherit', cursor: 'pointer' }}
                              onClick={() => quitarSerieDeTipo(t.codigo, serie)}
                              aria-label={`Quitar serie ${serie}`}
                              title="Quitar serie"
                            >
                              <FiX size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <small className="text-muted" style={{ fontSize: '0.72rem' }}>
                        Sin series asignadas (opcional — puedes escribir varias separadas por coma)
                      </small>
                    )}
                  </div>
                );
              })}

              {editingId && (
                <div className="mb-3 d-flex align-items-center">
                  <input
                    type="checkbox"
                    id="local-activo"
                    className="form-check-input me-2"
                    checked={activo}
                    onChange={(e) => setActivo(e.target.checked)}
                  />
                  <label htmlFor="local-activo" className="form-check-label" style={{ fontSize: '0.84rem' }}>
                    Local Activo (visible en filtros)
                  </label>
                </div>
              )}

              <div className="d-flex gap-2 mt-3">
                <button
                  type="submit"
                  disabled={busy}
                  className="btn btn-primary px-3 py-2 rounded-3 flex-grow-1 fw-semibold"
                >
                  {saveMutation.isPending
                    ? 'Guardando...'
                    : editingId
                      ? 'Guardar Cambios'
                      : 'Agregar Local'}
                </button>
                {editingId && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="btn btn-outline-secondary px-3 py-2 rounded-3"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>

        {/* Listado de Locales de la Empresa */}
        <div className="col-lg-7">
          <div className="card-premium">
            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
              <div>
                <h5 className="mb-0 fw-bold">
                  Locales de {empresaSeleccionada?.razon_social || 'Empresa'} ({locales.length})
                </h5>
                <small className="text-muted">
                  Haz clic en editar para actualizar o quitar series de cualquier local.
                </small>
              </div>
            </div>

            {successMsg && (
              <div className="alert alert-success py-2 px-3 mb-3 border-0 rounded-3" style={{ fontSize: '0.84rem' }}>
                <FiCheck className="me-2" /> {successMsg}
              </div>
            )}

            {isLoading ? (
              <SkeletonTable rows={6} columns={5} title="Cargando locales y series..." />
            ) : locales.length === 0 ? (
              <div
                className="text-center py-5 rounded-3"
                style={{ backgroundColor: 'rgba(241, 245, 249, 0.6)', border: '1px dashed var(--border-color)' }}
              >
                <FiMapPin className="text-muted fs-2 mb-2" />
                <p className="text-muted mb-0 fw-semibold">
                  Esta empresa aún no tiene locales configurados.
                </p>
                <small className="text-muted">
                  Usa el formulario de la izquierda para registrar sus locales y series.
                </small>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover table-dense align-middle mb-0">
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                      <th>LOCAL</th>
                      <th>SERIE FACTURA</th>
                      <th>SERIE BOLETA</th>
                      <th>SERIE N. CRÉDITO / DÉBITO</th>
                      <th className="text-center">ESTADO</th>
                      <th className="text-center">ACCIONES</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locales.map((loc) => {
                      const notas = [...(loc.seriesPorTipo['07'] || []), ...(loc.seriesPorTipo['08'] || [])];
                      return (
                        <tr key={loc.id} className={editingId === loc.id ? 'table-active' : ''}>
                          <td className="fw-bold">{loc.nombre}</td>
                          <td>
                            <div className="d-flex flex-wrap gap-1">
                              {loc.seriesPorTipo['01'].length > 0 ? (
                                loc.seriesPorTipo['01'].map((s) => (
                                  <span
                                    key={s}
                                    className="badge font-mono"
                                    style={{ backgroundColor: 'rgba(37, 99, 235, 0.1)', color: '#1D4ED8' }}
                                  >
                                    {s}
                                  </span>
                                ))
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </div>
                          </td>
                          <td>
                            <div className="d-flex flex-wrap gap-1">
                              {loc.seriesPorTipo['03'].length > 0 ? (
                                loc.seriesPorTipo['03'].map((s) => (
                                  <span
                                    key={s}
                                    className="badge font-mono"
                                    style={{ backgroundColor: 'rgba(5, 150, 105, 0.1)', color: '#047857' }}
                                  >
                                    {s}
                                  </span>
                                ))
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </div>
                          </td>
                          <td>
                            <div className="d-flex flex-wrap gap-1">
                              {notas.length > 0 ? (
                                notas.map((s) => (
                                  <span
                                    key={s}
                                    className="badge font-mono"
                                    style={{ backgroundColor: 'rgba(217, 119, 6, 0.12)', color: '#B45309' }}
                                  >
                                    {s}
                                  </span>
                                ))
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </div>
                          </td>
                          <td className="text-center">
                            {loc.activo ? (
                              <span className="badge badge-status badge-status-ok">Activo</span>
                            ) : (
                              <span className="badge badge-status badge-status-error">Inactivo</span>
                            )}
                          </td>
                          <td className="text-center text-nowrap">
                            <button
                              type="button"
                              onClick={() => handleEdit(loc)}
                              className="btn btn-sm btn-outline-warning me-1"
                              title="Editar local y series"
                            >
                              <FiEdit2 />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(loc)}
                              className="btn btn-sm btn-outline-danger"
                              title="Eliminar local"
                              disabled={busy}
                            >
                              <FiTrash2 />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export default ConfiguracionLocales;
