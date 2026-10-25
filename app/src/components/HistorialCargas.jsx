import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../utils/supabaseClient';
import { FiClock, FiUser, FiArrowRight, FiTrash2, FiRefreshCw } from 'react-icons/fi';

export default function HistorialCargas({ activeCompany, onSelectPeriod, onDeletePeriod, activeModule }) {
  const { data: history = [], isLoading, refetch } = useQuery({
    queryKey: ['cargaHistory', activeCompany?.id, activeModule],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_historial_cargas')
        .select('*')
        .eq('empresa_id', activeCompany.id)
        .eq('modulo', activeModule)
        .order('fecha_carga', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!activeCompany?.id && !!activeModule,
  });

  const handleDelete = async (periodoId, label) => {
    const ok = window.confirm(`¿Está seguro de que desea eliminar el período "${label}"? Esta acción borrará permanentemente todos sus comprobantes de validación para liberar espacio.`);
    if (!ok) return;

    try {
      const { error } = await supabase
        .from('periodos_carga')
        .delete()
        .eq('id', periodoId);

      if (error) throw error;

      refetch(); // Refrescar historial local
      if (onDeletePeriod) {
        onDeletePeriod(periodoId); // Notificar al padre
      }
    } catch (err) {
      console.error('Error al eliminar período:', err);
      alert(`Error al eliminar: ${err.message}`);
    }
  };

  const loading = isLoading;

  const formatDate = (isoString) => {
    if (!isoString) return '';
    return new Date(isoString).toLocaleString('es-PE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="card-premium animate-fade-in w-100 p-4">
      <div className="d-flex flex-column flex-sm-row justify-content-between align-items-start align-items-sm-center mb-3 gap-2">
        <div>
          <h4 className="mb-1 fw-bold" style={{ color: 'var(--color-text)', letterSpacing: '-0.02em' }}>
            Historial de Procesos Contables
          </h4>
          <p className="text-muted mb-0" style={{ fontSize: '0.86rem' }}>
            Listado de períodos procesados y validados. Selecciona uno para abrir la conciliación detallada.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={loading}
          className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1.5 px-3 py-1.5 rounded-3 fw-semibold"
          style={{ cursor: 'pointer' }}
        >
          <FiRefreshCw className={loading ? 'spin' : ''} />
          <span>Actualizar</span>
        </button>
      </div>

      {loading ? (
        <div className="text-center py-5">
          <div className="spinner-border text-primary" role="status"></div>
          <p className="text-muted mt-2" style={{ fontSize: '0.88rem' }}>Cargando bitácora de cargas...</p>
        </div>
      ) : history.length === 0 ? (
        <div 
          className="text-center py-5 rounded-3 my-3"
          style={{ backgroundColor: 'rgba(241, 245, 249, 0.6)', border: '1px dashed var(--border-color)' }}
        >
          <FiClock className="text-muted fs-1 mb-2" />
          <p className="text-muted mb-0 fw-semibold" style={{ fontSize: '0.9rem' }}>
            Aún no se registran procesos para esta empresa.
          </p>
          <small className="text-muted">Carga los archivos TXT correspondientes para iniciar.</small>
        </div>
      ) : (
        <div className="table-responsive mt-3">
          <table className="table table-hover table-dense align-middle text-nowrap mb-0">
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                <th style={{ backgroundColor: 'var(--bg-surface)' }}>PERÍODO</th>
                <th style={{ backgroundColor: 'var(--bg-surface)' }}>FECHA DE PROCESO</th>
                <th style={{ backgroundColor: 'var(--bg-surface)' }}>OPERADOR</th>
                <th className="text-end" style={{ backgroundColor: 'var(--bg-surface)' }}>REGISTROS</th>
                <th className="text-end" style={{ backgroundColor: 'var(--bg-surface)' }}>CORRECTOS (OK)</th>
                <th className="text-end" style={{ backgroundColor: 'var(--bg-surface)' }}>OBSERVADOS</th>
                <th className="text-end" style={{ backgroundColor: 'var(--bg-surface)' }}>ERRORES</th>
                <th className="text-center" style={{ backgroundColor: 'var(--bg-surface)' }}>ESTADO</th>
                <th className="text-center" style={{ backgroundColor: 'var(--bg-surface)' }}>ACCIONES</th>
              </tr>
            </thead>
            <tbody>
              {history.map(item => (
                <tr key={item.periodo_id}>
                  <td className="fw-bold text-success font-mono">
                    {item.periodo.slice(0, 4)}-{item.periodo.slice(4)}
                    {item.dia && ` (Día: ${item.dia}, v${item.version || 1})`}
                  </td>
                  <td className="font-mono text-muted" style={{ fontSize: '0.82rem' }}>
                    {formatDate(item.fecha_carga)}
                  </td>
                  <td>
                    <div className="d-flex align-items-center">
                      <FiUser className="me-2 text-muted" />
                      <span className="fw-semibold" style={{ fontSize: '0.85rem' }}>{item.usuario_nombre || 'N/A'}</span>
                    </div>
                  </td>
                  <td className="text-end font-mono fw-semibold">{item.total_registros?.toLocaleString('es-PE')}</td>
                  <td className="text-end font-mono text-success fw-semibold">{item.ok_registros?.toLocaleString('es-PE')}</td>
                  <td className="text-end font-mono text-warning fw-semibold">{item.observado_registros?.toLocaleString('es-PE')}</td>
                  <td className="text-end font-mono text-danger fw-semibold">{item.error_registros?.toLocaleString('es-PE')}</td>
                  <td className="text-center">
                    {item.estado_carga === 'completado' ? (
                      <span className="badge badge-status badge-status-ok">Completado</span>
                    ) : (
                      <span className="badge badge-status badge-status-error">{item.estado_carga}</span>
                    )}
                  </td>
                  <td className="text-center">
                    <div className="d-flex gap-2 justify-content-center">
                      <button
                        type="button"
                        onClick={() => onSelectPeriod(item.periodo_id, item.periodo, item.dia, item.version)}
                        className="btn btn-sm btn-outline-primary d-flex align-items-center fw-semibold px-2.5 py-1 rounded-2"
                        style={{ cursor: 'pointer', fontSize: '0.82rem' }}
                      >
                        <span>Cargar</span>
                        <FiArrowRight className="ms-1" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          let label = item.periodo;
                          if (item.dia) label += ` (Día: ${item.dia}, v${item.version || 1})`;
                          handleDelete(item.periodo_id, label);
                        }}
                        className="btn btn-sm btn-outline-danger d-flex align-items-center px-2 py-1 rounded-2"
                        style={{ cursor: 'pointer', fontSize: '0.82rem' }}
                        title="Eliminar período y liberar espacio"
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
      )}
    </div>
  );
}
