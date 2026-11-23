// ============================================================================
// Panel de 7 indicadores generales del módulo de Compras (Sección 7.A):
//  1. Total de documentos SAP
//  2. Total de documentos SUNAT
//  3. Documentos OK
//  4. Documentos con diferencias
//  5. Documentos con observaciones
//  6. Documentos que no existen en SUNAT
//  7. Documentos que no existen en SAP
// ============================================================================
import React, { memo } from 'react';
import {
  FiDatabase,
  FiFileText,
  FiCheckCircle,
  FiXCircle,
  FiAlertTriangle,
  FiArrowRightCircle,
  FiArrowLeftCircle,
} from 'react-icons/fi';

const TarjetasIndicadoresCompras = memo(function TarjetasIndicadoresCompras({
  indicadores,
  totalSinFiltro,
  onSelectKpi,
  kpiActivo,
}) {
  const pct = (val, base = indicadores.totalUnicos) =>
    base > 0 ? `${((val / base) * 100).toFixed(1)}%` : '0.0%';

  const tarjetas = [
    {
      id: 'SAP',
      titulo: 'Total Docs SAP',
      valor: indicadores.totalSap,
      sub: `${pct(indicadores.totalSap)} del universo (${indicadores.coincidentes} en ambos)`,
      color: '#4F46E5',
      bg: 'rgba(79, 70, 229, 0.1)',
      icono: <FiDatabase />,
      filtro: { origen: 'SAP', resultado: 'ALL', tipoError: 'ALL', tipoObs: 'ALL', codigos: [] },
    },
    {
      id: 'SUNAT',
      titulo: 'Total Docs SUNAT',
      valor: indicadores.totalSunat,
      sub: `${pct(indicadores.totalSunat)} del universo (${indicadores.coincidentes} en ambos)`,
      color: '#2563EB',
      bg: 'rgba(37, 99, 235, 0.1)',
      icono: <FiFileText />,
      filtro: { origen: 'SUNAT', resultado: 'ALL', tipoError: 'ALL', tipoObs: 'ALL', codigos: [] },
    },
    {
      id: 'OK',
      titulo: 'Documentos OK',
      valor: indicadores.ok,
      sub:
        indicadores.tipo14Ok > 0
          ? `${pct(indicadores.ok)} · incluye ${indicadores.tipo14Ok} tipo 14`
          : `${pct(indicadores.ok)} sin diferencias`,
      color: '#059669',
      bg: 'rgba(5, 150, 105, 0.1)',
      icono: <FiCheckCircle />,
      claseTexto: 'text-success',
      filtro: { origen: 'ALL', resultado: 'OK', tipoError: 'ALL', tipoObs: 'ALL', codigos: [] },
    },
    {
      id: 'CON_DIFERENCIAS',
      titulo: 'Con Diferencias',
      valor: indicadores.conDiferencias,
      sub: `${pct(indicadores.conDiferencias)} en SAP y SUNAT con error`,
      color: '#DC2626',
      bg: 'rgba(220, 38, 38, 0.1)',
      icono: <FiXCircle />,
      claseTexto: 'text-danger',
      filtro: { origen: 'ALL', resultado: 'CON_DIFERENCIAS', tipoError: 'ALL', tipoObs: 'ALL', codigos: [] },
    },
    {
      id: 'CON_OBSERVACIONES',
      titulo: 'Con Observaciones',
      valor: indicadores.conObservaciones,
      sub:
        indicadores.conCualquierObs > indicadores.conObservaciones
          ? `${pct(indicadores.conObservaciones)} (${indicadores.conCualquierObs} total con obs.)`
          : `${pct(indicadores.conObservaciones)} requieren revisión`,
      color: '#D97706',
      bg: 'rgba(217, 119, 6, 0.1)',
      icono: <FiAlertTriangle />,
      claseTexto: 'text-warning',
      filtro: { origen: 'ALL', resultado: 'CON_OBSERVACIONES', tipoError: 'ALL', tipoObs: 'ALL', codigos: [] },
    },
    {
      id: 'NO_EXISTE_SUNAT',
      titulo: 'No Existen en SUNAT',
      valor: indicadores.noExisteSunat,
      sub: 'ERROR 6 (excluye recibos tipo 14)',
      color: '#B91C1C',
      bg: 'rgba(185, 28, 28, 0.1)',
      icono: <FiArrowRightCircle />,
      claseTexto: indicadores.noExisteSunat > 0 ? 'text-danger' : '',
      filtro: { origen: 'ALL', resultado: 'NO_EXISTE_SUNAT', tipoError: 'ALL', tipoObs: 'ALL', codigos: [] },
    },
    {
      id: 'NO_EXISTE_SAP',
      titulo: 'No Existen en SAP',
      valor: indicadores.noExisteSap,
      sub: 'OBS 1 (presentes solo en SUNAT)',
      color: '#B45309',
      bg: 'rgba(180, 83, 9, 0.1)',
      icono: <FiArrowLeftCircle />,
      claseTexto: indicadores.noExisteSap > 0 ? 'text-warning' : '',
      filtro: { origen: 'ALL', resultado: 'NO_EXISTE_SAP', tipoError: 'ALL', tipoObs: 'ALL', codigos: [] },
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
            onClick={() =>
              onSelectKpi &&
              onSelectKpi('ALL', { origen: 'ALL', resultado: 'ALL', tipoError: 'ALL', tipoObs: 'ALL', codigos: [] })
            }
          >
            Mostrar todos los documentos
          </button>
        </div>
      )}
      <div className="row g-2">
        {tarjetas.map((t) => {
          const activo = kpiActivo === t.id;
          return (
            <div key={t.id} className="col-xl col-lg-4 col-md-6" style={{ minWidth: '13.5%' }}>
              <div
                className="card-premium card-clickable d-flex align-items-center h-100"
                onClick={() => onSelectKpi && onSelectKpi(t.id, t.filtro)}
                style={{
                  padding: '0.8rem 0.9rem',
                  borderColor: activo ? t.color : undefined,
                  boxShadow: activo ? `0 0 0 2px ${t.bg}` : undefined,
                }}
                title={`Clic para filtrar: ${t.titulo}`}
              >
                <div
                  className="rounded-3 d-flex align-items-center justify-content-center flex-shrink-0"
                  style={{
                    width: '38px',
                    height: '38px',
                    backgroundColor: t.bg,
                    color: t.color,
                    fontSize: '1.1rem',
                    marginRight: '0.7rem',
                  }}
                >
                  {t.icono}
                </div>
                <div className="text-truncate">
                  <div
                    className="text-muted fw-semibold text-truncate"
                    style={{ fontSize: '0.67rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}
                  >
                    {t.titulo}
                  </div>
                  <h4
                    className={`fw-bold mb-0 font-mono ${t.claseTexto || ''}`}
                    style={{ color: t.claseTexto ? undefined : 'var(--color-text)' }}
                  >
                    {t.valor.toLocaleString('es-PE')}
                  </h4>
                  <small className="text-muted d-block text-truncate" style={{ fontSize: '0.69rem' }} title={t.sub}>
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

export default TarjetasIndicadoresCompras;
