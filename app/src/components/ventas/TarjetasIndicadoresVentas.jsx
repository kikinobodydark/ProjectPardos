// ============================================================================
// Panel de 10 indicadores generales del módulo de Ventas (Sección 3.B).
// - Se actualiza automáticamente según los filtros aplicados.
// - Todos los conteos se basan en documentos únicos.
// - Cada tarjeta es clicable para abrir o filtrar el detalle correspondiente.
// ============================================================================
import React, { memo } from 'react';
import {
  FiDatabase, FiFileText, FiLink, FiCheckCircle, FiAlertTriangle,
  FiXCircle, FiArrowRightCircle, FiArrowLeftCircle, FiDollarSign, FiUserCheck,
} from 'react-icons/fi';

const TarjetasIndicadoresVentas = memo(function TarjetasIndicadoresVentas({ indicadores, totalSinFiltro, onSelectKpi, kpiActivo }) {
  const pct = (val, base = indicadores.totalUnicos) =>
    base > 0 ? `${((val / base) * 100).toFixed(1)}%` : '0.0%';

  const tarjetas = [
    {
      id: 'SAP',
      titulo: 'Registrados en SAP',
      valor: indicadores.totalSap,
      sub: `${pct(indicadores.totalSap)} del universo`,
      color: '#4F46E5',
      bg: 'rgba(79, 70, 229, 0.1)',
      icono: <FiDatabase />,
      filtro: { estado: 'ALL', existencia: 'SAP', categoria: 'ALL', codigos: [] },
    },
    {
      id: 'SUNAT',
      titulo: 'Registrados en SUNAT',
      valor: indicadores.totalSunat,
      sub: `${pct(indicadores.totalSunat)} del universo`,
      color: '#2563EB',
      bg: 'rgba(37, 99, 235, 0.1)',
      icono: <FiFileText />,
      filtro: { estado: 'ALL', existencia: 'SUNAT', categoria: 'ALL', codigos: [] },
    },
    {
      id: 'COINCIDENTES',
      titulo: 'Documentos Coincidentes',
      valor: indicadores.coincidentes,
      sub: 'Presentes en SAP y SUNAT',
      color: '#0284C7',
      bg: 'rgba(2, 132, 199, 0.1)',
      icono: <FiLink />,
      filtro: { estado: 'ALL', existencia: 'AMBOS', categoria: 'ALL', codigos: [] },
    },
    {
      id: 'CORRECTOS',
      titulo: 'Documentos Correctos',
      valor: indicadores.correctos,
      sub: `${pct(indicadores.correctos)} sin incidencias`,
      color: '#059669',
      bg: 'rgba(5, 150, 105, 0.1)',
      icono: <FiCheckCircle />,
      claseTexto: 'text-success',
      filtro: { estado: 'OK', existencia: 'ALL', categoria: 'ALL', codigos: [] },
    },
    {
      id: 'OBSERVACIONES',
      titulo: 'Con Observaciones',
      valor: indicadores.conObservaciones,
      sub: `${pct(indicadores.conObservaciones)} requieren revisión`,
      color: '#D97706',
      bg: 'rgba(217, 119, 6, 0.1)',
      icono: <FiAlertTriangle />,
      claseTexto: 'text-warning',
      filtro: { estado: 'OBSERVADO', existencia: 'ALL', categoria: 'ALL', codigos: [] },
    },
    {
      id: 'ERRORES',
      titulo: 'Con Errores (Docs únicos)',
      valor: indicadores.conErrores,
      sub:
        indicadores.totalHallazgosError > indicadores.conErrores
          ? `${pct(indicadores.conErrores)} · ${indicadores.totalHallazgosError.toLocaleString('es-PE')} hallazgos (${indicadores.docsConMultiplesErrores} multi-error)`
          : `${pct(indicadores.conErrores)} incumplimientos`,
      color: '#DC2626',
      bg: 'rgba(220, 38, 38, 0.1)',
      icono: <FiXCircle />,
      claseTexto: 'text-danger',
      filtro: { estado: 'ERROR', existencia: 'ALL', categoria: 'ALL', codigos: [] },
    },
    {
      id: 'SOLO_SAP',
      titulo: 'Únicamente en SAP',
      valor: indicadores.soloSap,
      sub: 'OBS 5: No existe en SUNAT',
      color: '#B45309',
      bg: 'rgba(180, 83, 9, 0.1)',
      icono: <FiArrowRightCircle />,
      filtro: { estado: 'ALL', existencia: 'ALL', categoria: 'ALL', codigos: ['OBS 5'] },
    },
    {
      id: 'SOLO_SUNAT',
      titulo: 'Únicamente en SUNAT',
      valor: indicadores.soloSunat,
      sub: 'OBS 4: No existe en SAP',
      color: '#B45309',
      bg: 'rgba(180, 83, 9, 0.1)',
      icono: <FiArrowLeftCircle />,
      filtro: { estado: 'ALL', existencia: 'ALL', categoria: 'ALL', codigos: ['OBS 4'] },
    },
    {
      id: 'DIF_IMPORTES',
      titulo: 'Diferencias de Importes',
      valor: indicadores.conDifImportes,
      sub: 'ERROR 1 al 5 y 7 (> S/ 0.05)',
      color: '#DC2626',
      bg: 'rgba(220, 38, 38, 0.1)',
      icono: <FiDollarSign />,
      claseTexto: indicadores.conDifImportes > 0 ? 'text-danger' : '',
      filtro: { estado: 'ALL', existencia: 'ALL', categoria: 'DIF_IMPORTES', codigos: [] },
    },
    {
      id: 'PROB_IDENTIDAD',
      titulo: 'Problemas de Identificación',
      valor: indicadores.conProbIdentidad,
      sub: 'ERROR 6, OBS 1, OBS 2, reglas ID',
      color: '#7C3AED',
      bg: 'rgba(124, 58, 237, 0.1)',
      icono: <FiUserCheck />,
      filtro: { estado: 'ALL', existencia: 'ALL', categoria: 'PROB_IDENTIDAD', codigos: [] },
    },
  ];

  const hayFiltro = totalSinFiltro !== undefined && totalSinFiltro !== indicadores.totalUnicos;

  return (
    <div className="mb-3">
      {hayFiltro && (
        <div className="d-flex justify-content-between align-items-center mb-2 px-1">
          <small className="text-muted">
            Indicadores calculados sobre <strong>{indicadores.totalUnicos.toLocaleString('es-PE')}</strong> de{' '}
            <strong>{totalSinFiltro.toLocaleString('es-PE')}</strong> documentos únicos (filtros activos).
          </small>
          <button
            type="button"
            className="btn btn-sm btn-link p-0 fw-semibold"
            onClick={() => onSelectKpi && onSelectKpi('ALL', { estado: 'ALL', existencia: 'ALL', categoria: 'ALL', codigos: [] })}
          >
            Mostrar todos los documentos
          </button>
        </div>
      )}
      <div className="row g-2">
        {tarjetas.map((t) => {
          const activo = kpiActivo === t.id;
          return (
            <div key={t.id} className="col-xl col-lg-4 col-md-6" style={{ minWidth: '18%' }}>
              <div
                className="card-premium card-clickable d-flex align-items-center p-2.5 h-100"
                onClick={() => onSelectKpi && onSelectKpi(t.id, t.filtro)}
                style={{
                  padding: '0.85rem 1rem',
                  borderColor: activo ? t.color : undefined,
                  boxShadow: activo ? `0 0 0 2px ${t.bg}` : undefined,
                }}
                title={`Clic para ver detalle: ${t.titulo}`}
              >
                <div
                  className="rounded-3 me-2.5 d-flex align-items-center justify-content-center flex-shrink-0"
                  style={{
                    width: '40px',
                    height: '40px',
                    backgroundColor: t.bg,
                    color: t.color,
                    fontSize: '1.15rem',
                    marginRight: '0.75rem',
                  }}
                >
                  {t.icono}
                </div>
                <div className="text-truncate">
                  <div
                    className="text-muted fw-semibold text-truncate"
                    style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}
                  >
                    {t.titulo}
                  </div>
                  <h4 className={`fw-bold mb-0 font-mono ${t.claseTexto || ''}`} style={{ color: t.claseTexto ? undefined : 'var(--color-text)' }}>
                    {t.valor.toLocaleString('es-PE')}
                  </h4>
                  <small className="text-muted d-block text-truncate" style={{ fontSize: '0.7rem' }}>
                    {t.sub}
                  </small>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default TarjetasIndicadoresVentas;
