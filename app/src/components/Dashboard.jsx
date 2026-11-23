import React, { useState, useEffect, useMemo, memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../utils/supabaseClient';
import {
  FiCheckCircle, FiAlertTriangle, FiXCircle, FiLayers, FiDownload, FiArrowRight,
} from 'react-icons/fi';
import { useDocumentosVentas } from './ventas/useDocumentosVentas';
import { useLocalesEmpresa, coincideConLocal } from '../utils/useLocalesEmpresa';
import TarjetasIndicadoresVentas from './ventas/TarjetasIndicadoresVentas';
import SelectorLocal from './SelectorLocal';
import { SkeletonDashboard, SkeletonKpiGrid } from './SkeletonLoader';
import { INCIDENCIAS } from '../utils/ventas/catalogos';
import { REPORTES_ESPECIFICOS, calcularIndicadores, exportarExcelVentas } from '../utils/ventas/reportes';
import { formatoMonto, dentroDeTolerancia } from '../utils/ventas/montos';

const COLS_RESUMEN_COMPRAS =
  'total_registros, ok_registros, error_registros, observado_registros, sum_base_sap, sum_base_sunat, sum_igv_sap, sum_igv_sunat, sum_total_sap, sum_total_sunat';

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
      onNavigateToReconciliation={onNavigateToReconciliation}
      activeModule={activeModule}
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

  const pct = (val) => (ind.totalUnicos > 0 ? `${((val / ind.totalUnicos) * 100).toFixed(1)}%` : '0.0%');

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
            className="btn btn-sm btn-outline-primary d-flex align-items-center fw-semibold"
            onClick={() => exportarExcelVentas({ tipo: 'completo', docs, todosDocs: docs, periodo: activePeriod || 'periodo' })}
          >
            <FiDownload className="me-1.5" /> Exportar Libro Completo
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary d-flex align-items-center fw-semibold"
            onClick={() => irAConciliacion('ALL')}
          >
            Ir a Tabla de Conciliación <FiArrowRight className="ms-1.5" />
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
            <div className="col-lg-7">
              <div className="card-premium h-100 p-3 d-flex flex-column justify-content-between">
                <div>
                  <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
                    <div>
                      <h5 className="mb-0 fw-bold">Comparativa Monetaria (SAP vs. SUNAT — Tolerancia S/ 0.05)</h5>
                      <small className="text-muted" style={{ fontSize: '0.75rem' }}>
                        {modoComparativa === 'coincidentes'
                          ? `Solo documentos presentes en SAP y SUNAT (${ind.coincidentes.toLocaleString('es-PE')} docs) — coincide con ERROR 1 al 5 y 7.`
                          : `Suma total del archivo SAP (${ind.totalSap.toLocaleString('es-PE')}) vs. SUNAT (${ind.totalSunat.toLocaleString('es-PE')}), incluyendo documentos sin par (OBS 4 / OBS 5).`}
                      </small>
                    </div>
                    <div className="btn-group btn-group-sm" role="group" aria-label="Modo de comparativa monetaria">
                      <button
                        type="button"
                        className={`btn ${modoComparativa === 'coincidentes' ? 'btn-primary' : 'btn-outline-secondary'}`}
                        style={{ fontSize: '0.74rem' }}
                        onClick={() => setModoComparativa('coincidentes')}
                      >
                        Coincidentes ({ind.coincidentes.toLocaleString('es-PE')})
                      </button>
                      <button
                        type="button"
                        className={`btn ${modoComparativa === 'lote' ? 'btn-primary' : 'btn-outline-secondary'}`}
                        style={{ fontSize: '0.74rem' }}
                        onClick={() => setModoComparativa('lote')}
                      >
                        Total Lote ({ind.totalUnicos.toLocaleString('es-PE')})
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

                {haySinCoincidencia && (
                  <div
                    className="mt-2 pt-2 border-top d-flex flex-wrap align-items-center justify-content-between gap-2"
                    style={{ borderColor: 'var(--border-color)', fontSize: '0.75rem' }}
                  >
                    <span className="text-muted fw-semibold">Impacto de documentos sin par (no incluidos en ERROR 1-5/7):</span>
                    <div className="d-flex flex-wrap gap-2">
                      {ind.soloSunat > 0 && (
                        <button
                          type="button"
                          className="btn btn-sm py-0 px-2 rounded-2 font-mono fw-semibold"
                          style={{ backgroundColor: 'rgba(217, 119, 6, 0.1)', color: '#B45309', border: '1px solid rgba(217, 119, 6, 0.25)', fontSize: '0.73rem' }}
                          onClick={() => irAConciliacion({ vista: 'tabla', filtros: { codigos: ['OBS 4'] } })}
                        >
                          OBS 4 Solo SUNAT ({ind.soloSunat}): BI S/ {formatoMonto(ind.sumasSoloSunat.base)} · Total S/ {formatoMonto(ind.sumasSoloSunat.total)}
                        </button>
                      )}
                      {ind.soloSap > 0 && (
                        <button
                          type="button"
                          className="btn btn-sm py-0 px-2 rounded-2 font-mono fw-semibold"
                          style={{ backgroundColor: 'rgba(180, 83, 9, 0.1)', color: '#92400E', border: '1px solid rgba(180, 83, 9, 0.25)', fontSize: '0.73rem' }}
                          onClick={() => irAConciliacion({ vista: 'tabla', filtros: { codigos: ['OBS 5'] } })}
                        >
                          OBS 5 Solo SAP ({ind.soloSap}): BI S/ {formatoMonto(ind.sumasSoloSap.base)} · Total S/ {formatoMonto(ind.sumasSoloSap.total)}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Jerarquía de Estados (Verde / Ámbar / Rojo) */}
            <div className="col-lg-5">
              <div className="card-premium h-100 p-3 d-flex flex-column justify-content-between">
                <div>
                  <h5 className="mb-2 fw-bold">Distribución por Estado General</h5>
                  <p className="text-muted mb-3" style={{ fontSize: '0.8rem' }}>
                    Prioridad de clasificación: <strong>ERROR</strong> sobre <strong>OBSERVACIÓN</strong> y <strong>OBSERVACIÓN</strong> sobre <strong>CORRECTO</strong>.
                  </p>

                  {[
                    { estado: 'OK', label: 'CORRECTO', count: ind.correctos, clase: 'ok', bar: 'bg-success', desc: 'Cálculos, identidad, boletas > S/ 700 e importes dentro de S/ 0.05.' },
                    { estado: 'OBSERVADO', label: 'OBSERVACIÓN', count: ind.conObservaciones, clase: 'observado', bar: 'bg-warning', desc: 'Diferencias de identidad, secuencia o existencia únicamente en un sistema.' },
                    { estado: 'ERROR', label: 'ERROR', count: ind.conErrores, clase: 'error', bar: 'bg-danger', desc: 'Diferencias de importes > S/ 0.05 o boletas > S/ 700 sin DNI.' },
                  ].map((e) => (
                    <div
                      key={e.estado}
                      className="p-2 rounded-2 mb-2"
                      style={{ backgroundColor: '#F8FAFC', border: '1px solid var(--border-color)', cursor: 'pointer' }}
                      onClick={() => irAConciliacion({ vista: 'tabla', filtros: { estado: e.estado } })}
                    >
                      <div className="d-flex justify-content-between align-items-center mb-1">
                        <div className="d-flex align-items-center gap-2">
                          <span className={`badge badge-status badge-status-${e.clase}`}>{e.label}</span>
                          <small className="text-muted">{e.desc}</small>
                        </div>
                        <span className="font-mono fw-bold">{e.count.toLocaleString('es-PE')} ({pct(e.count)})</span>
                      </div>
                      <div className="progress" style={{ height: '6px' }}>
                        <div className={`progress-bar ${e.bar}`} style={{ width: pct(e.count) }} />
                      </div>
                    </div>
                  ))}
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
                    <tfoot>
                      <tr style={{ backgroundColor: 'rgba(220, 38, 38, 0.05)' }}>
                        <td colSpan={2} className="fw-bold text-danger" style={{ fontSize: '0.78rem' }}>
                          Total hallazgos de ERROR
                          {ind.docsConMultiplesErrores > 0 && (
                            <span className="fw-normal text-muted ms-1">
                              ({ind.conErrores.toLocaleString('es-PE')} docs únicos · {ind.docsConMultiplesErrores} con múltiples errores)
                            </span>
                          )}
                        </td>
                        <td className="text-end font-mono fw-bold text-danger">
                          {ind.totalHallazgosError.toLocaleString('es-PE')}
                        </td>
                        <td className="text-center">
                          <button
                            type="button"
                            className="btn btn-sm btn-link p-0 text-danger text-decoration-none fw-semibold"
                            style={{ fontSize: '0.75rem' }}
                            onClick={() => irAConciliacion({ vista: 'tabla', filtros: { estado: 'ERROR' } })}
                          >
                            Ver {ind.conErrores.toLocaleString('es-PE')} docs →
                          </button>
                        </td>
                      </tr>
                      <tr style={{ backgroundColor: 'rgba(217, 119, 6, 0.05)' }}>
                        <td colSpan={2} className="fw-bold text-warning" style={{ fontSize: '0.78rem' }}>
                          Total hallazgos de OBSERVACIÓN
                          <span className="fw-normal text-muted ms-1">
                            ({ind.conObservaciones.toLocaleString('es-PE')} docs clasificados en estado Observado)
                          </span>
                        </td>
                        <td className="text-end font-mono fw-bold text-warning">
                          {ind.totalHallazgosObs.toLocaleString('es-PE')}
                        </td>
                        <td className="text-center">
                          <button
                            type="button"
                            className="btn btn-sm btn-link p-0 text-warning text-decoration-none fw-semibold"
                            style={{ fontSize: '0.75rem' }}
                            onClick={() => irAConciliacion({ vista: 'tabla', filtros: { estado: 'OBSERVADO' } })}
                          >
                            Ver {ind.conObservaciones.toLocaleString('es-PE')} docs →
                          </button>
                        </td>
                      </tr>
                    </tfoot>
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
// Dashboard del módulo de Compras (consultas en paralelo + columnas explícitas + skeleton)
// ============================================================================
const DashboardCompras = memo(function DashboardCompras({ periodId, onNavigateToReconciliation, activeModule }) {
  const { data: stats = {
    total: 0, ok: 0, errors: 0, observed: 0,
    baseSap: 0, baseSunat: 0, igvSap: 0, igvSunat: 0, totalSap: 0, totalSunat: 0,
    countObs1: 0, countObs2: 0, countSapOk: 0, countSunatOk: 0,
  }, isLoading } = useQuery({
    queryKey: ['dashboardStats', periodId, activeModule],
    queryFn: async () => {
      const [resumenRes, obs1Res, obs2Res, sapObsIdOkRes, sunatObsIdOkRes] = await Promise.all([
        supabase.from('v_resumen_compras').select(COLS_RESUMEN_COMPRAS).eq('periodo_id', periodId).single(),
        supabase.from('detalle_compras').select('id', { count: 'exact', head: true }).eq('periodo_id', periodId)
          .contains('errores_json', JSON.stringify(['OBS 6: RUC PROVEEDOR INVÁLIDO (SAP)'])),
        supabase.from('detalle_compras').select('id', { count: 'exact', head: true }).eq('periodo_id', periodId)
          .contains('errores_json', JSON.stringify(['OBS 7: RUC PROVEEDOR INVÁLIDO (SUNAT)'])),
        supabase.from('detalle_compras').select('id', { count: 'exact', head: true }).eq('periodo_id', periodId)
          .eq('estado_validacion', 'OBSERVADO').or('nro_identidad_sap.not.is.null,nombre_sap.not.is.null')
          .not('errores_json', 'cs', '["OBS 6: RUC PROVEEDOR INVÁLIDO (SAP)"]'),
        supabase.from('detalle_compras').select('id', { count: 'exact', head: true }).eq('periodo_id', periodId)
          .eq('estado_validacion', 'OBSERVADO').or('nro_identidad_sunat.not.is.null,nombre_sunat.not.is.null')
          .not('errores_json', 'cs', '["OBS 7: RUC PROVEEDOR INVÁLIDO (SUNAT)"]'),
      ]);

      if (resumenRes.error && resumenRes.error.code !== 'PGRST116') throw resumenRes.error;
      const summary = resumenRes.data || {};
      return {
        total: parseInt(summary.total_registros, 10) || 0,
        ok: parseInt(summary.ok_registros, 10) || 0,
        errors: parseInt(summary.error_registros, 10) || 0,
        observed: parseInt(summary.observado_registros, 10) || 0,
        baseSap: parseFloat(summary.sum_base_sap) || 0,
        baseSunat: parseFloat(summary.sum_base_sunat) || 0,
        igvSap: parseFloat(summary.sum_igv_sap) || 0,
        igvSunat: parseFloat(summary.sum_igv_sunat) || 0,
        totalSap: parseFloat(summary.sum_total_sap) || 0,
        totalSunat: parseFloat(summary.sum_total_sunat) || 0,
        countObs1: obs1Res.count || 0,
        countObs2: obs2Res.count || 0,
        countSapOk: sapObsIdOkRes.count || 0,
        countSunatOk: sunatObsIdOkRes.count || 0,
      };
    },
    enabled: !!periodId && !!activeModule,
  });

  const getPercentage = (value) => (stats.total === 0 ? '0%' : `${((value / stats.total) * 100).toFixed(1)}%`);

  return (
    <div className="animate-fade-in w-100">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h3 className="mb-1 fw-bold" style={{ letterSpacing: '-0.02em', color: 'var(--color-text)' }}>
            Panel Resumen Ejecutivo
          </h3>
          <p className="text-muted mb-0" style={{ fontSize: '0.86rem' }}>
            Métricas de conciliación y calidad de datos del período seleccionado
          </p>
        </div>
      </div>

      {isLoading ? (
        <SkeletonKpiGrid count={4} />
      ) : (
        <div className="row g-3 mb-4">
          <div className="col-xl-3 col-sm-6">
            <div className="card-premium card-clickable d-flex align-items-center p-3 h-100" onClick={() => onNavigateToReconciliation && onNavigateToReconciliation('ALL')}>
              <div className="rounded-3 p-3 me-3 d-flex align-items-center justify-content-center flex-shrink-0" style={{ width: '52px', height: '52px', backgroundColor: 'rgba(79, 70, 229, 0.1)', color: '#4F46E5', fontSize: '1.4rem' }}>
                <FiLayers />
              </div>
              <div className="text-truncate">
                <div className="text-muted fw-semibold" style={{ fontSize: '0.72rem', textTransform: 'uppercase' }}>TOTAL COMPROBANTES</div>
                <h3 className="fw-bold mb-0 font-mono">{stats.total.toLocaleString('es-PE')}</h3>
                <small className="text-muted" style={{ fontSize: '0.75rem' }}>100% de la carga procesada</small>
              </div>
            </div>
          </div>
          <div className="col-xl-3 col-sm-6">
            <div className="card-premium card-clickable d-flex align-items-center p-3 h-100" onClick={() => onNavigateToReconciliation && onNavigateToReconciliation('OK')}>
              <div className="rounded-3 p-3 me-3 d-flex align-items-center justify-content-center flex-shrink-0" style={{ width: '52px', height: '52px', backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#059669', fontSize: '1.4rem' }}>
                <FiCheckCircle />
              </div>
              <div className="text-truncate">
                <div className="text-muted fw-semibold" style={{ fontSize: '0.72rem', textTransform: 'uppercase' }}>REGISTROS CORRECTOS</div>
                <h3 className="fw-bold mb-0 text-success font-mono">{stats.ok.toLocaleString('es-PE')}</h3>
                <small className="text-success font-mono fw-semibold" style={{ fontSize: '0.75rem' }}>{getPercentage(stats.ok)} del total</small>
              </div>
            </div>
          </div>
          <div className="col-xl-3 col-sm-6">
            <div className="card-premium card-clickable d-flex align-items-center p-3 h-100" onClick={() => onNavigateToReconciliation && onNavigateToReconciliation('OBSERVADO')}>
              <div className="rounded-3 p-3 me-3 d-flex align-items-center justify-content-center flex-shrink-0" style={{ width: '52px', height: '52px', backgroundColor: 'rgba(217, 119, 6, 0.1)', color: '#D97706', fontSize: '1.4rem' }}>
                <FiAlertTriangle />
              </div>
              <div className="text-truncate">
                <div className="text-muted fw-semibold" style={{ fontSize: '0.72rem', textTransform: 'uppercase' }}>OBSERVACIONES</div>
                <h3 className="fw-bold mb-0 text-warning font-mono">{stats.observed.toLocaleString('es-PE')}</h3>
                <small className="text-warning font-mono fw-semibold" style={{ fontSize: '0.75rem' }}>{getPercentage(stats.observed)} de advertencia</small>
              </div>
            </div>
          </div>
          <div className="col-xl-3 col-sm-6">
            <div className="card-premium card-clickable d-flex align-items-center p-3 h-100" onClick={() => onNavigateToReconciliation && onNavigateToReconciliation('ERROR')}>
              <div className="rounded-3 p-3 me-3 d-flex align-items-center justify-content-center flex-shrink-0" style={{ width: '52px', height: '52px', backgroundColor: 'rgba(220, 38, 38, 0.1)', color: '#DC2626', fontSize: '1.4rem' }}>
                <FiXCircle />
              </div>
              <div className="text-truncate">
                <div className="text-muted fw-semibold" style={{ fontSize: '0.72rem', textTransform: 'uppercase' }}>CON DISCREPANCIAS / ERROR</div>
                <h3 className="fw-bold mb-0 text-danger font-mono">{stats.errors.toLocaleString('es-PE')}</h3>
                <small className="text-danger font-mono fw-semibold" style={{ fontSize: '0.75rem' }}>{getPercentage(stats.errors)} críticos</small>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
