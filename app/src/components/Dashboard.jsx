import React, { useState, useEffect, useMemo, memo } from 'react';
import { FiDownload, FiArrowRight } from 'react-icons/fi';
import { useDocumentosVentas } from './ventas/useDocumentosVentas';
import { useDocumentosCompras } from './compras/useDocumentosCompras';
import { useLocalesEmpresa, coincideConLocal } from '../utils/useLocalesEmpresa';
import TarjetasIndicadoresVentas from './ventas/TarjetasIndicadoresVentas';
import TarjetasIndicadoresCompras from './compras/TarjetasIndicadoresCompras';
import SelectorLocal from './SelectorLocal';
import { SkeletonDashboard } from './SkeletonLoader';
import { INCIDENCIAS } from '../utils/ventas/catalogos';
import { REPORTES_ESPECIFICOS, calcularIndicadores, exportarExcelVentas } from '../utils/ventas/reportes';
import { formatoMonto, dentroDeTolerancia } from '../utils/ventas/montos';
import {
  INCIDENCIAS_COMPRAS,
  CONCEPTOS_IMPORTE_COMPRAS,
} from '../utils/compras/catalogos';
import {
  calcularIndicadoresCompras,
  exportarExcelCompras,
} from '../utils/compras/reportes';

const Dashboard = memo(function Dashboard({
  activeCompany, periodId, activePeriod, onNavigateToReconciliation, activeModule,
  selectedLocalId = 'ALL', onChangeLocalId,
}) {
  if (activeModule !== 'compras') {
    return (
      <DashboardVentas
        activeCompany={activeCompany}
        periodId={periodId}
        activePeriod={activePeriod}
        onNavigateToReconciliation={onNavigateToReconciliation}
        selectedLocalId={selectedLocalId}
        onChangeLocalId={onChangeLocalId}
      />
    );
  }
  return (
    <DashboardCompras
      periodId={periodId}
      activePeriod={activePeriod}
      onNavigateToReconciliation={onNavigateToReconciliation}
    />
  );
});

export default Dashboard;

// ============================================================================
// Dashboard del módulo de Ventas (Secciones 3.B, 8, 9, 11 y 13)
// ============================================================================
const DashboardVentas = memo(function DashboardVentas({
  activeCompany, periodId, activePeriod, onNavigateToReconciliation,
  selectedLocalId = 'ALL', onChangeLocalId,
}) {
  const { data: todosDocs = [], isLoading } = useDocumentosVentas(periodId, true);
  const { localesActivos, indiceLocales, isFetched: localesFetched, isLoading: localesLoading } = useLocalesEmpresa(activeCompany?.id, true);
  const [modoComparativa, setModoComparativa] = useState('coincidentes'); // 'coincidentes' | 'lote'

  const localId = selectedLocalId || 'ALL';
  const setLocalId = (val) => {
    if (onChangeLocalId) onChangeLocalId(val);
  };

  // Solo reiniciar si ya cargaron los locales de la empresa y el local elegido ya no existe
  useEffect(() => {
    if (
      localesFetched &&
      !localesLoading &&
      localId !== 'ALL' &&
      localId !== 'SIN_LOCAL' &&
      !localesActivos.some((l) => l.id === localId)
    ) {
      if (onChangeLocalId) onChangeLocalId('ALL');
    }
  }, [localesFetched, localesLoading, localId, localesActivos, onChangeLocalId]);

  const docs = useMemo(() => {
    if (localId === 'ALL' || localesActivos.length === 0) return todosDocs;
    return todosDocs.filter((d) => coincideConLocal(d, localId, indiceLocales));
  }, [todosDocs, localId, localesActivos.length, indiceLocales]);

  const ind = useMemo(() => calcularIndicadores(docs), [docs]);

  const irAConciliacion = (payload) => {
    if (!onNavigateToReconciliation) return;
    if (typeof payload === 'object' && payload !== null) {
      onNavigateToReconciliation({
        ...payload,
        filtros: { ...(payload.filtros || {}), localId },
      });
      return;
    }
    if (payload === 'ALL') {
      onNavigateToReconciliation({ vista: 'tabla', filtros: { localId } });
      return;
    }
    onNavigateToReconciliation(payload);
  };

  const sumasActivas = modoComparativa === 'coincidentes' ? ind.sumasCoincidentes : ind.sumas;
  const haySinCoincidencia = ind.soloSunat > 0 || ind.soloSap > 0;

  return (
    <div className="animate-fade-in w-100">
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
        <div>
          <h3 className="mb-1 fw-bold" style={{ letterSpacing: '-0.02em', color: 'var(--color-text)' }}>
            Panel Resumen Ejecutivo de Conciliación (SAP vs. SUNAT)
          </h3>
          <p className="text-muted mb-0" style={{ fontSize: '0.86rem' }}>
            Haga clic en cualquier tarjeta, estado, grupo de error u observación para abrir el detalle de los documentos.
          </p>
        </div>
        <div className="d-flex align-items-center flex-wrap gap-2">
          <SelectorLocal
            locales={localesActivos}
            value={localId}
            onChange={setLocalId}
            mostrarSinAsignar
            align="right"
          />
          <button
            type="button"
            disabled={docs.length === 0}
            className="dashboard-action-btn dashboard-action-btn--secondary"
            onClick={() => exportarExcelVentas({ tipo: 'completo', docs, todosDocs: docs, periodo: activePeriod || 'periodo' })}
          >
            <FiDownload />
            <span>Exportar Libro Completo</span>
          </button>
          <button
            type="button"
            className="dashboard-action-btn dashboard-action-btn--primary"
            onClick={() => irAConciliacion('ALL')}
          >
            <span>Ir a Tabla de Conciliación</span>
            <FiArrowRight />
          </button>
        </div>
      </div>

      {isLoading ? (
        <SkeletonDashboard kpiCount={10} />
      ) : (
        <>
          {/* 10 Indicadores Generales (Sección 3.B) */}
          <TarjetasIndicadoresVentas
            indicadores={ind}
            totalSinFiltro={docs.length}
            onSelectKpi={(id, filtro) => irAConciliacion({ vista: 'tabla', kpi: id, filtros: filtro })}
          />

          <div className="row g-3 mb-3">
            {/* Comparativa monetaria por los conceptos verificados */}
            <div className="col-12">
              <div className="card-premium h-100 p-3 d-flex flex-column justify-content-between">
                <div>
                  <div className="d-flex justify-content-between align-items-start align-items-md-center flex-wrap gap-3 mb-3">
                    <div>
                      <h5 className="mb-0 fw-bold">Comparativa Monetaria (SAP vs. SUNAT — Tolerancia S/ 0.05)</h5>
                      <small className="text-muted" style={{ fontSize: '0.78rem' }}>
                        {modoComparativa === 'coincidentes'
                          ? `Solo documentos presentes en SAP y SUNAT (${ind.coincidentes.toLocaleString('es-PE')} docs) — coincide con ERROR 1 al 5 y 7.`
                          : `Suma total del archivo SAP (${ind.totalSap.toLocaleString('es-PE')}) vs. SUNAT (${ind.totalSunat.toLocaleString('es-PE')}), incluyendo documentos sin par (OBS 4 / OBS 5).`}
                      </small>
                    </div>
                    <div className="segmented-toggle" role="group" aria-label="Modo de comparativa monetaria">
                      <button
                        type="button"
                        aria-pressed={modoComparativa === 'coincidentes'}
                        className={`segmented-toggle-btn ${modoComparativa === 'coincidentes' ? 'is-active' : ''}`}
                        onClick={() => setModoComparativa('coincidentes')}
                      >
                        <span>Coincidentes</span>
                        <span className="segmented-toggle-count font-mono">{ind.coincidentes.toLocaleString('es-PE')}</span>
                      </button>
                      <button
                        type="button"
                        aria-pressed={modoComparativa === 'lote'}
                        className={`segmented-toggle-btn ${modoComparativa === 'lote' ? 'is-active' : ''}`}
                        onClick={() => setModoComparativa('lote')}
                      >
                        <span>Total Lote</span>
                        <span className="segmented-toggle-count font-mono">{ind.totalUnicos.toLocaleString('es-PE')}</span>
                      </button>
                    </div>
                  </div>
                  <div className="table-responsive">
                    <table className="table table-hover table-dense align-middle mb-0">
                      <thead>
                        <tr>
                          <th>Concepto</th>
                          <th className="text-end">SAP (S/)</th>
                          <th className="text-end">SUNAT (S/)</th>
                          <th className="text-end">Diferencia (S/)</th>
                          <th className="text-center">Docs Afectados</th>
                          <th className="text-center">Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['Base Imponible Gravada', sumasActivas.base_sap, sumasActivas.base_sunat, 'ERROR 1'],
                          ['IGV / IPM', sumasActivas.igv_sap, sumasActivas.igv_sunat, 'ERROR 2'],
                          ['Monto Exonerado', sumasActivas.exonerado_sap, sumasActivas.exonerado_sunat, 'ERROR 3'],
                          ['Monto Inafecto', sumasActivas.inafecto_sap, sumasActivas.inafecto_sunat, 'ERROR 4'],
                          ['Otros Tributos / Servicios', sumasActivas.otros_sap, sumasActivas.otros_sunat, 'ERROR 7'],
                          ['Importe Total', sumasActivas.total_sap, sumasActivas.total_sunat, 'ERROR 5'],
                        ].map(([concepto, s, u, codigo]) => {
                          const dif = s - u;
                          const afectados = ind.porCodigo[codigo] || 0;
                          const soloPorSinPar = modoComparativa === 'lote' && afectados === 0 && !dentroDeTolerancia(dif) && haySinCoincidencia;
                          const ok = afectados === 0 && dentroDeTolerancia(dif);
                          return (
                            <tr
                              key={codigo}
                              style={{ cursor: 'pointer' }}
                              onClick={() =>
                                irAConciliacion(
                                  soloPorSinPar
                                    ? { vista: 'tabla', filtros: { codigos: ['OBS 4', 'OBS 5'] } }
                                    : { vista: 'tabla', filtros: { codigos: [codigo] } }
                                )
                              }
                            >
                              <td className="fw-semibold">{concepto}</td>
                              <td className="text-end font-mono">{formatoMonto(s)}</td>
                              <td className="text-end font-mono">{formatoMonto(u)}</td>
                              <td className={`text-end font-mono ${!dentroDeTolerancia(dif) ? (soloPorSinPar ? 'text-warning fw-bold' : 'text-danger fw-bold') : 'text-success'}`}>
                                {formatoMonto(dif)}
                              </td>
                              <td className="text-center font-mono fw-bold">
                                {afectados.toLocaleString('es-PE')}
                                {soloPorSinPar && (
                                  <span className="text-warning fw-normal ms-1" style={{ fontSize: '0.7rem' }}>
                                    (+{(ind.soloSunat + ind.soloSap).toLocaleString('es-PE')} sin par)
                                  </span>
                                )}
                              </td>
                              <td className="text-center">
                                {ok ? (
                                  <span className="badge badge-status badge-status-ok">CORRECTO</span>
                                ) : soloPorSinPar ? (
                                  <span className="badge badge-status badge-status-observado">OBS 4 / 5</span>
                                ) : (
                                  <span className="badge badge-status badge-status-error">{codigo}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Desglose por Grupo de Errores y Observaciones + Acceso a los 12 Reportes Específicos */}
          <div className="row g-3">
            <div className="col-lg-7">
              <div className="card-premium h-100 p-3">
                <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">
                  <div>
                    <h5 className="mb-0 fw-bold">Incidencias por Código (Clic para ver documentos afectados)</h5>
                    <small className="text-muted" style={{ fontSize: '0.75rem' }}>
                      Un mismo comprobante puede registrar más de un código a la vez (por eso la suma de hallazgos puede superar el total de documentos únicos).
                    </small>
                  </div>
                </div>
                <div className="table-responsive">
                  <table className="table table-hover table-dense align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Descripción</th>
                        <th className="text-end">Documentos Afectados</th>
                        <th className="text-center">Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {INCIDENCIAS.map((inc) => {
                        const count = ind.porCodigo[inc.codigo] || 0;
                        return (
                          <tr
                            key={inc.codigo}
                            style={{ cursor: 'pointer' }}
                            onClick={() => irAConciliacion({ vista: 'tabla', filtros: { codigos: [inc.codigo] } })}
                          >
                            <td>
                              <span className={`badge badge-status badge-status-${inc.tipo === 'ERROR' ? 'error' : 'observado'}`}>
                                {inc.codigo}
                              </span>
                            </td>
                            <td className="fw-semibold">{inc.corto}</td>
                            <td className="text-end font-mono fw-bold">{count.toLocaleString('es-PE')}</td>
                            <td className="text-center">
                              <span className="text-primary fw-semibold" style={{ fontSize: '0.76rem' }}>
                                Ver detalle →
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="col-lg-5">
              <div className="card-premium h-100 p-3">
                <h5 className="mb-2 fw-bold">Reportes Específicos Independientes (12)</h5>
                <p className="text-muted mb-2" style={{ fontSize: '0.8rem' }}>
                  Seleccione un reporte para abrirlo directamente con sus columnas pertinentes:
                </p>
                <div className="d-flex flex-column gap-1.5" style={{ gap: '6px' }}>
                  {REPORTES_ESPECIFICOS.map((rep) => (
                    <button
                      key={rep.id}
                      type="button"
                      className="btn btn-sm btn-outline-secondary text-start d-flex justify-content-between align-items-center py-1.5 px-2.5 rounded-2"
                      onClick={() => irAConciliacion({ vista: 'reportes', reporteId: rep.id })}
                    >
                      <span className="fw-semibold" style={{ fontSize: '0.8rem' }}>{rep.titulo}</span>
                      <FiArrowRight />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
});

// ============================================================================
// Dashboard del módulo de Compras (Conciliación SAP vs. SUNAT — RCE)
// ============================================================================
const DashboardCompras = memo(function DashboardCompras({
  periodId,
  activePeriod,
  onNavigateToReconciliation,
}) {
  const { data: docs = [], isLoading } = useDocumentosCompras(periodId, true);
  const [modoComparativa, setModoComparativa] = useState('coincidentes'); // 'coincidentes' | 'lote'

  const ind = useMemo(() => calcularIndicadoresCompras(docs), [docs]);

  const irAConciliacion = (payload) => {
    if (!onNavigateToReconciliation) return;
    onNavigateToReconciliation(payload);
  };

  const sumasActivas = modoComparativa === 'coincidentes' ? ind.sumasCoincidentes : ind.sumas;

  return (
    <div className="animate-fade-in w-100">
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
        <div>
          <h3 className="mb-1 fw-bold" style={{ letterSpacing: '-0.02em', color: 'var(--color-text)' }}>
            Panel Resumen Ejecutivo de Compras (SAP vs. SUNAT)
          </h3>
          <p className="text-muted mb-0" style={{ fontSize: '0.86rem' }}>
            Conciliación automatizada por clave única (RUC + Tipo Doc. + Serie + Correlativo). Haga clic en cualquier indicador para filtrar.
          </p>
        </div>
        <div className="d-flex align-items-center flex-wrap gap-2">
          <button
            type="button"
            disabled={docs.length === 0}
            className="dashboard-action-btn dashboard-action-btn--secondary dashboard-action-btn--compras"
            onClick={() => exportarExcelCompras({ docs, alcance: 'completo', periodo: activePeriod || 'periodo' })}
          >
            <FiDownload />
            <span>Exportar Excel Completo</span>
          </button>
          <button
            type="button"
            className="dashboard-action-btn dashboard-action-btn--primary dashboard-action-btn--compras"
            onClick={() => irAConciliacion('ALL')}
          >
            <span>Ir a Tabla de Conciliación</span>
            <FiArrowRight />
          </button>
        </div>
      </div>

      {isLoading ? (
        <SkeletonDashboard kpiCount={7} />
      ) : (
        <>
          {/* 7 Indicadores Generales (Sección 7.A) */}
          <TarjetasIndicadoresCompras
            indicadores={ind}
            totalSinFiltro={docs.length}
            onSelectKpi={(id, filtro) => irAConciliacion({ kpi: id, filtros: filtro })}
          />

          <div className="row g-3 mb-3">
            {/* Comparativa Monetaria SAP vs SUNAT */}
            <div className="col-12">
              <div className="card-premium h-100 p-3 d-flex flex-column justify-content-between">
                <div>
                  <div className="d-flex justify-content-between align-items-start align-items-md-center flex-wrap gap-3 mb-3">
                    <div>
                      <h5 className="mb-0 fw-bold">Comparativa Monetaria de Compras (SAP vs. SUNAT)</h5>
                      <small className="text-muted" style={{ fontSize: '0.78rem' }}>
                        {modoComparativa === 'coincidentes'
                          ? `Solo documentos coincidentes en SAP y SUNAT (${ind.coincidentes.toLocaleString('es-PE')} docs) — precisión decimal exacta.`
                          : `Suma total del archivo SAP (${ind.totalSap.toLocaleString('es-PE')}) vs. SUNAT (${ind.totalSunat.toLocaleString('es-PE')}).`}
                      </small>
                    </div>
                    <div className="segmented-toggle segmented-toggle--compras" role="group" aria-label="Modo de comparativa monetaria de compras">
                      <button
                        type="button"
                        aria-pressed={modoComparativa === 'coincidentes'}
                        className={`segmented-toggle-btn ${modoComparativa === 'coincidentes' ? 'is-active' : ''}`}
                        onClick={() => setModoComparativa('coincidentes')}
                      >
                        <span>Coincidentes</span>
                        <span className="segmented-toggle-count font-mono">{ind.coincidentes.toLocaleString('es-PE')}</span>
                      </button>
                      <button
                        type="button"
                        aria-pressed={modoComparativa === 'lote'}
                        className={`segmented-toggle-btn ${modoComparativa === 'lote' ? 'is-active' : ''}`}
                        onClick={() => setModoComparativa('lote')}
                      >
                        <span>Total Lote</span>
                        <span className="segmented-toggle-count font-mono">{ind.totalUnicos.toLocaleString('es-PE')}</span>
                      </button>
                    </div>
                  </div>
                  <div className="table-responsive">
                    <table className="table table-hover table-dense align-middle mb-0">
                      <thead>
                        <tr>
                          <th>Concepto</th>
                          <th className="text-end">SAP (S/)</th>
                          <th className="text-end">SUNAT (S/)</th>
                          <th className="text-end">Diferencia (S/)</th>
                          <th className="text-center">Docs Afectados</th>
                          <th className="text-center">Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {CONCEPTOS_IMPORTE_COMPRAS.map((c) => {
                          const s = sumasActivas[`${c.campo}_sap`] || 0;
                          const u = sumasActivas[`${c.campo}_sunat`] || 0;
                          const dif = s - u;
                          const afectados = ind.porCodigo[c.codigo] || 0;
                          const ok = afectados === 0 && dif === 0;
                          return (
                            <tr
                              key={c.codigo}
                              style={{ cursor: 'pointer' }}
                              onClick={() => irAConciliacion({ filtros: { codigos: [c.codigo] } })}
                            >
                              <td className="fw-semibold">{c.concepto}</td>
                              <td className="text-end font-mono">{formatoMonto(s)}</td>
                              <td className="text-end font-mono">{formatoMonto(u)}</td>
                              <td className={`text-end font-mono ${dif !== 0 ? 'text-danger fw-bold' : 'text-success'}`}>
                                {formatoMonto(dif)}
                              </td>
                              <td className="text-center font-mono fw-bold">{afectados.toLocaleString('es-PE')}</td>
                              <td className="text-center">
                                {ok ? (
                                  <span className="badge badge-status badge-status-ok">OK</span>
                                ) : (
                                  <span className="badge badge-status badge-status-error">{c.codigo}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Desglose por Error (1–8) y Observación (1–3) */}
          <div className="card-premium p-3">
            <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">
              <div>
                <h5 className="mb-0 fw-bold">Detalle de Errores (1–8) y Observaciones (1–3)</h5>
                <small className="text-muted" style={{ fontSize: '0.75rem' }}>
                  Un documento puede acumular múltiples errores y observaciones simultáneamente sin sobrescribirse.
                </small>
              </div>
            </div>
            <div className="table-responsive">
              <table className="table table-hover table-dense align-middle mb-0">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Categoría</th>
                    <th>Descripción</th>
                    <th className="text-end">Documentos Afectados</th>
                    <th className="text-center">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {INCIDENCIAS_COMPRAS.map((inc) => {
                    const count = ind.porCodigo[inc.codigo] || 0;
                    const esErr = inc.tipo === 'ERROR';
                    return (
                      <tr
                        key={inc.codigo}
                        style={{ cursor: 'pointer' }}
                        onClick={() => irAConciliacion({ filtros: { codigos: [inc.codigo] } })}
                      >
                        <td>
                          <span className={`badge badge-status badge-status-${esErr ? 'error' : 'observado'}`}>
                            {inc.codigo}
                          </span>
                        </td>
                        <td className="text-muted fw-semibold" style={{ fontSize: '0.75rem' }}>
                          {esErr ? 'ERROR' : 'OBSERVACIÓN'}
                        </td>
                        <td className="fw-semibold">{inc.descripcion}</td>
                        <td className="text-end font-mono fw-bold">{count.toLocaleString('es-PE')}</td>
                        <td className="text-center">
                          <span className="text-primary fw-semibold" style={{ fontSize: '0.76rem' }}>
                            Ver detalle →
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
});
