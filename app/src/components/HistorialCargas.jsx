import React, { useState, useEffect } from 'react';
import { supabase } from '../utils/supabaseClient';
import { FiCheckCircle, FiClock, FiUser, FiArrowRight, FiLayers } from 'react-icons/fi';

export default function HistorialCargas({ activeCompany, onSelectPeriod }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchHistory();
  }, [activeCompany]);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('v_historial_cargas')
        .select('*')
        .eq('empresa_id', activeCompany.id)
        .order('fecha_carga', { ascending: false });

      if (error) throw error;
      setHistory(data || []);
    } catch (e) {
      console.error("Error al obtener historial:", e);
    } finally {
      setLoading(false);
    }
  };

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
        <h4 className="text-white mb-0 fw-bold">Historial de Procesos Contables</h4>
        <button
          onClick={fetchHistory}
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
                    <button
                      onClick={() => onSelectPeriod(item.periodo_id, item.periodo)}
                      className="btn btn-sm btn-outline-primary d-flex align-items-center justify-content-center mx-auto"
                      style={{ cursor: 'pointer', padding: '0.3rem 0.8rem', borderRadius: '6px' }}
                    >
                      Cargar <FiArrowRight className="ms-1" />
                    </button>
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
