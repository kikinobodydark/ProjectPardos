// ============================================================================
// Componentes visuales reutilizables para OBS 3 (Secuencia de Correlativos):
// - Muestra exactamente los correlativos faltantes (p.ej. F635-3446)
// - Indica claramente si el salto ocurre en SAP, SUNAT o AMBOS (SAP y SUNAT)
// ============================================================================
import React, { useState, useMemo, memo } from 'react';
import { FiAlertTriangle, FiDownload, FiEye } from 'react-icons/fi';
import { descripcionTipoCP } from '../../utils/ventas/catalogos';
import { ETIQUETA_SISTEMA_SALTO } from '../../utils/ventas/reglas';
import { crearDocFaltanteDetalle } from '../../utils/ventas/reportes';

export const BadgeSistemaSalto = memo(function BadgeSistemaSalto({ sistema }) {
  if (!sistema) return null;
  const estilos = {
    AMBOS: {
      bg: 'rgba(220, 38, 38, 0.12)',
      color: '#B91C1C',
      border: 'rgba(220, 38, 38, 0.28)',
      texto: ETIQUETA_SISTEMA_SALTO.AMBOS,
    },
    SUNAT: {
      bg: 'rgba(37, 99, 235, 0.12)',
      color: '#1D4ED8',
      border: 'rgba(37, 99, 235, 0.28)',
      texto: ETIQUETA_SISTEMA_SALTO.SUNAT,
    },
    SAP: {
      bg: 'rgba(124, 58, 237, 0.12)',
      color: '#6D28D9',
      border: 'rgba(124, 58, 237, 0.28)',
      texto: ETIQUETA_SISTEMA_SALTO.SAP,
    },
  };
  const cfg = estilos[sistema] || {
    bg: 'rgba(217, 119, 6, 0.12)',
    color: '#B45309',
    border: 'rgba(217, 119, 6, 0.28)',
    texto: sistema,
  };

  return (
    <span
      className="badge font-mono"
      style={{
        backgroundColor: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.border}`,
        fontSize: '0.72rem',
        fontWeight: 700,
      }}
    >
      {cfg.texto}
    </span>
  );
});

export const ListaCorrelativosFaltantes = memo(function ListaCorrelativosFaltantes({
  serie,
  correlativos = [],
  total = 0,
  rangoTexto = '',
  truncado = false,
  limiteInicial = 8,
  mostrarSerie = true,
  onSelectCorrelativo,
}) {
  const [expandido, setExpandido] = useState(false);

  if (!correlativos || correlativos.length === 0) {
    return rangoTexto ? <span className="font-mono fw-bold text-danger">{rangoTexto}</span> : <span className="text-muted">—</span>;
  }

  const visibles = expandido ? correlativos : correlativos.slice(0, limiteInicial);
  const ocultos = Math.max(0, total - visibles.length);

  return (
    <div className="d-flex flex-wrap align-items-center gap-1">
      {visibles.map((corr) =>
        onSelectCorrelativo ? (
          <button
            key={corr}
            type="button"
            className="badge font-mono"
            style={{
              backgroundColor: 'rgba(220, 38, 38, 0.09)',
              color: '#B91C1C',
              border: '1px solid rgba(220, 38, 38, 0.28)',
              fontSize: '0.74rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
            title={`Ver detalle del comprobante faltante ${serie ? `${serie}-${corr}` : corr}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelectCorrelativo(corr);
            }}
          >
            {mostrarSerie && serie ? `${serie}-${corr}` : corr}
          </button>
        ) : (
          <span
            key={corr}
            className="badge font-mono"
            style={{
              backgroundColor: 'rgba(220, 38, 38, 0.09)',
              color: '#B91C1C',
              border: '1px solid rgba(220, 38, 38, 0.28)',
              fontSize: '0.74rem',
              fontWeight: 700,
            }}
          >
            {mostrarSerie && serie ? `${serie}-${corr}` : corr}
          </span>
        )
      )}
      {!expandido && ocultos > 0 && (
        <button
          type="button"
          className="btn btn-sm btn-link p-0 ms-1 text-decoration-none fw-semibold"
          style={{ fontSize: '0.74rem' }}
          onClick={(e) => {
            e.stopPropagation();
            setExpandido(true);
          }}
        >
          +{ocultos.toLocaleString('es-PE')} más ({rangoTexto})
        </button>
      )}
      {expandido && correlativos.length > limiteInicial && (
        <button
          type="button"
          className="btn btn-sm btn-link p-0 ms-1 text-decoration-none fw-semibold"
          style={{ fontSize: '0.74rem' }}
          onClick={(e) => {
            e.stopPropagation();
            setExpandido(false);
          }}
        >
          Ver menos
        </button>
      )}
      {expandido && truncado && (
        <span className="text-muted font-mono" style={{ fontSize: '0.72rem' }}>
          (Mostrando primeros {correlativos.length} de {total.toLocaleString('es-PE')}: {rangoTexto})
        </span>
      )}
    </div>
  );
});

const PanelSaltosSecuenciaVentas = memo(function PanelSaltosSecuenciaVentas({
  saltos = [],
  onSelectDoc,
  onExportarSecuencia,
}) {
  const [filtroSistema, setFiltroSistema] = useState('ALL'); // ALL | AMBOS | SUNAT | SAP

  const conteos = useMemo(() => {
    let ambos = 0;
    let sunat = 0;
    let sap = 0;
    let totalFaltantes = 0;
    for (const s of saltos) {
      totalFaltantes += s.faltantes || 0;
      if (s.sistema === 'AMBOS') ambos += 1;
      else if (s.sistema === 'SUNAT') sunat += 1;
      else if (s.sistema === 'SAP') sap += 1;
    }
    return { ambos, sunat, sap, totalFaltantes };
  }, [saltos]);

  const saltosVisibles = useMemo(
    () => (filtroSistema === 'ALL' ? saltos : saltos.filter((s) => s.sistema === filtroSistema)),
    [saltos, filtroSistema]
  );

  if (saltos.length === 0) return null;

  return (
    <div
      className="p-3 rounded-3 mb-3 animate-fade-in"
      style={{
        backgroundColor: 'rgba(255, 251, 235, 0.85)',
        border: '1px solid rgba(217, 119, 6, 0.35)',
      }}
    >
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <FiAlertTriangle className="text-warning fs-5" />
          <span className="fw-bold" style={{ fontSize: '0.9rem', color: 'var(--color-text)' }}>
            Correlativos Faltantes Detectados (OBS 3)
          </span>
          <span className="badge badge-status badge-status-observado font-mono">
            {saltos.length} salto(s) · {conteos.totalFaltantes.toLocaleString('es-PE')} correlativo(s) faltante(s)
          </span>
        </div>

        <div className="d-flex align-items-center gap-2 flex-wrap">
          <div className="btn-group btn-group-sm" role="group" aria-label="Filtrar saltos por sistema">
            <button
              type="button"
              className={`btn ${filtroSistema === 'ALL' ? 'btn-primary' : 'btn-outline-secondary'}`}
              onClick={() => setFiltroSistema('ALL')}
            >
              Todos ({saltos.length})
            </button>
            <button
              type="button"
              className={`btn ${filtroSistema === 'AMBOS' ? 'btn-danger' : 'btn-outline-secondary'}`}
              onClick={() => setFiltroSistema('AMBOS')}
            >
              Ambos ({conteos.ambos})
            </button>
            <button
              type="button"
              className={`btn ${filtroSistema === 'SUNAT' ? 'btn-primary' : 'btn-outline-secondary'}`}
              onClick={() => setFiltroSistema('SUNAT')}
            >
              Solo SUNAT ({conteos.sunat})
            </button>
            <button
              type="button"
              className={`btn ${filtroSistema === 'SAP' ? 'btn-primary' : 'btn-outline-secondary'}`}
              onClick={() => setFiltroSistema('SAP')}
            >
              Solo SAP ({conteos.sap})
            </button>
          </div>

          {onExportarSecuencia && (
            <button
              type="button"
              className="btn btn-sm btn-outline-primary d-flex align-items-center fw-semibold"
              onClick={onExportarSecuencia}
            >
              <FiDownload className="me-1" /> Exportar Faltantes
            </button>
          )}
        </div>
      </div>

      <div className="table-responsive rounded-2" style={{ backgroundColor: '#FFFFFF', border: '1px solid var(--border-color)' }}>
        <table className="table table-sm table-hover table-dense align-middle mb-0">
          <thead>
            <tr>
              <th>Serie / Tipo</th>
              <th>Correlativo(s) Faltante(s)</th>
              <th>Salto Detectado (Ant. → Sig.)</th>
              <th className="text-center">¿Dónde se salta?</th>
              <th className="text-end">Cant. Faltante</th>
              <th className="text-center">Detalle Faltante</th>
            </tr>
          </thead>
          <tbody>
            {saltosVisibles.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-muted py-3">
                  No se registran saltos para el sistema seleccionado.
                </td>
              </tr>
            ) : (
              saltosVisibles.map((s, idx) => {
                const abrirFaltante = (corr) => {
                  if (onSelectDoc) {
                    onSelectDoc(crearDocFaltanteDetalle(s, corr || s.primer_faltante));
                  }
                };
                return (
                  <tr
                    key={`${s.tipo_doc_pago}-${s.serie}-${String(s.start)}-${s.sistema}-${idx}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => abrirFaltante(s.primer_faltante)}
                  >
                    <td>
                      <span className="font-mono fw-bold">{s.serie}</span>
                      <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                        {descripcionTipoCP(s.tipo_doc_pago)}
                      </div>
                    </td>
                    <td style={{ minWidth: '210px', whiteSpace: 'normal' }}>
                      <ListaCorrelativosFaltantes
                        serie={s.serie}
                        correlativos={s.correlativos_faltantes}
                        total={s.faltantes}
                        rangoTexto={s.rango_faltante}
                        truncado={s.faltantes_truncado}
                        limiteInicial={10}
                        onSelectCorrelativo={(corr) => abrirFaltante(corr)}
                      />
                    </td>
                    <td className="font-mono">
                      <span>{s.anterior}</span>
                      <span className="text-muted mx-1">→</span>
                      <span className="fw-semibold text-warning">{s.siguiente}</span>
                      <div className="text-muted" style={{ fontSize: '0.71rem' }}>
                        {s.fecha_anterior || 's/f'} → {s.fecha_siguiente || 's/f'}
                      </div>
                    </td>
                    <td className="text-center">
                      <BadgeSistemaSalto sistema={s.sistema} />
                    </td>
                    <td className="text-end font-mono fw-bold text-danger">
                      {s.faltantes.toLocaleString('es-PE')}
                    </td>
                    <td className="text-center">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger py-0 px-2 font-mono d-inline-flex align-items-center gap-1"
                        style={{ fontSize: '0.74rem' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          abrirFaltante(s.primer_faltante);
                        }}
                        title="Abrir detalle del correlativo faltante"
                      >
                        <FiEye /> {s.serie}-{s.primer_faltante || '?'}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
});

export default PanelSaltosSecuenciaVentas;
