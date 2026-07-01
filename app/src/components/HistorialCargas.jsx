import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../utils/supabaseClient';
import { FiCheckCircle, FiClock, FiUser, FiArrowRight, FiLayers, FiTrash2 } from 'react-icons/fi';

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
      alert('Período eliminado correctamente.');
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
    <div className="card-premium animate-fade-in">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="mb-0 fw-bold">Historial de Procesos Contables</h4>
        <button
          onClick={() => refetch()}
          disabled={loading}
          className="btn btn-sm btn-outline-secondary"
          style={{ cursor: 'pointer' }}
        >
          Actualizar Historial
        </button>
      </div>
      <p className="text-muted mb-4" style={{ fontSize: '0.88rem' }}>
        Listado de períodos que han sido validados previamente. Selecciona uno para cargar la conciliación.
      </p>

      {loading ? (
        <div className="text-center py-5">
          <div className="spinner-border text-primary" role="status"></div>
          <p className="text-muted mt-2">Cargando bitácora de cargas...</p>
        </div>
      ) : history.length === 0 ? (
        <div className="text-center py-5 bg-dark rounded-3 bg-opacity-25">
          <FiClock className="text-muted fs-1 mb-2" />
          <p className="text-muted mb-0">Aún no se registran procesos para esta empresa.</p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-dark table-borderless table-dense align-middle text-nowrap">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th>PERÍODO</th>
                <th>FECHA DE PROCESO</th>
                <th>OPERADOR</th>
                <th className="text-end">REGISTROS</th>
                <th className="text-end">CORRECTOS (OK)</th>
                <th className="text-end">CON OBSERVACIÓN</th>
                <th className="text-end">CON ERRORES</th>
                <th className="text-center">ESTADO</th>
                <th className="text-center">ACCIÓN</th>
              </tr>
            </thead>
            <tbody>
              {history.map(item => (
                <tr key={item.periodo_id}>
                  <td className="fw-bold text-success font-mono fs-6">
                    {item.periodo.slice(0, 4)}-{item.periodo.slice(4)}
                    {item.dia && ` (Día: ${item.dia}, v${item.version || 1})`}
                  </td>
                  <td className="font-mono">{formatDate(item.fecha_carga)}</td>
                  <td>
                    <div className="d-flex align-items-center">
                      <FiUser className="me-2 text-muted" />
                      <span>{item.usuario_nombre || 'N/A'}</span>
                    </div>
                  </td>
                  <td className="text-end font-mono">{item.total_registros}</td>
                  <td className="text-end font-mono text-success">{item.ok_registros}</td>
                  <td className="text-end font-mono text-warning">{item.observado_registros}</td>
                  <td className="text-end font-mono text-danger">{item.error_registros}</td>
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
                        onClick={() => onSelectPeriod(item.periodo_id, item.periodo, item.dia, item.version)}
                        className="btn btn-sm btn-outline-primary d-flex align-items-center"
                        style={{ cursor: 'pointer', padding: '0.3rem 0.6rem', borderRadius: '6px' }}
                      >
                        Cargar <FiArrowRight className="ms-1" />
                      </button>
                      <button
                        onClick={() => {
                          let label = item.periodo;
                          if (item.dia) label += ` (Día: ${item.dia}, v${item.version || 1})`;
                          handleDelete(item.periodo_id, label);
                        }}
                        className="btn btn-sm btn-outline-danger d-flex align-items-center"
                        style={{ cursor: 'pointer', padding: '0.3rem 0.6rem', borderRadius: '6px' }}
                        title="Eliminar período y liberar espacio"
                      >
                        <FiTrash2 className="me-1" /> Eliminar
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
