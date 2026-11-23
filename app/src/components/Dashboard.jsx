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

const Dashboard = memo(function Dashboard({ activeCompany, periodId, activePeriod, onNavigateToReconciliation, activeModule }) {
  if (activeModule !== 'compras') {
    return (
      <DashboardVentas
        activeCompany={activeCompany}
        periodId={periodId}
        activePeriod={activePeriod}
        onNavigateToReconciliation={onNavigateToReconciliation}
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
const DashboardVentas = memo(function DashboardVentas({ activeCompany, periodId, activePeriod, onNavigateToReconciliation }) {
  const { data: todosDocs = [], isLoading } = useDocumentosVentas(periodId, true);
  const { localesActivos, indiceLocales } = useLocalesEmpresa(activeCompany?.id, true);
  const [localId, setLocalId] = useState('ALL');

  // Reiniciar el filtro si cambia la empresa o si el local seleccionado fue eliminado/desactivado
  useEffect(() => {
    setLocalId('ALL');
  }, [activeCompany?.id]);

  useEffect(() => {
    if (localId !== 'ALL' && localId !== 'SIN_LOCAL' && !localesActivos.some((l) => l.id === localId)) {
      setLocalId('ALL');
    }
  }, [localId, localesActivos]);

  const docs = useMemo(() => {
    if (localId === 'ALL' || localesActivos.length === 0) return todosDocs;
    return todosDocs.filter((d) => coincideConLocal(d, localId, indiceLocales));
  }, [todosDocs, localId, localesActivos.length, indiceLocales]);

  const ind = useMemo(() => calcularIndicadores(docs), [docs]);

  const pct = (val) => (ind.totalUnicos > 0 ? `${((val / ind.totalUnicos) * 100).toFixed(1)}%` : '0.0%');

  const irAConciliacion = (payload) => {
    if (!onNavigateToReconciliation) return;
    if (localId !== 'ALL') {
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
    }
    onNavigateToReconciliation(payload);
  };

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
              <div className="card-premium h-100 p-3">
                <h5 className="mb-2 fw-bold">Comparativa Monetaria Lote (SAP vs. SUNAT — Tolerancia S/ 0.05)</h5>
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
                        ['Base Imponible Gravada', ind.sumas.base_sap, ind.sumas.base_sunat, 'ERROR 1'],
                        ['IGV / IPM', ind.sumas.igv_sap, ind.sumas.igv_sunat, 'ERROR 2'],
                        ['Monto Exonerado', ind.sumas.exonerado_sap, ind.sumas.exonerado_sunat, 'ERROR 3'],
                        ['Monto Inafecto', ind.sumas.inafecto_sap, ind.sumas.inafecto_sunat, 'ERROR 4'],
                        ['Otros Tributos / Servicios', ind.sumas.otros_sap, ind.sumas.otros_sunat, 'ERROR 7'],
                        ['Importe Total', ind.sumas.total_sap, ind.sumas.total_sunat, 'ERROR 5'],
                      ].map(([concepto, s, u, codigo]) => {
                        const dif = s - u;
                        const afectados = ind.porCodigo[codigo] || 0;
                        const ok = afectados === 0 && dentroDeTolerancia(dif);
                        return (
                          <tr
                            key={codigo}
                            style={{ cursor: 'pointer' }}
                            onClick={() => irAConciliacion({ vista: 'tabla', filtros: { codigos: [codigo] } })}
                          >
                            <td className="fw-semibold">{concepto}</td>
                            <td className="text-end font-mono">{formatoMonto(s)}</td>
                            <td className="text-end font-mono">{formatoMonto(u)}</td>
                            <td className={`text-end font-mono ${!dentroDeTolerancia(dif) ? 'text-danger fw-bold' : 'text-success'}`}>
                              {formatoMonto(dif)}
                            </td>
                            <td className="text-center font-mono fw-bold">{afectados}</td>
                            <td className="text-center">
                              <span className={`badge badge-status badge-status-${ok ? 'ok' : 'error'}`}>
                                {ok ? 'CORRECTO' : codigo}
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
                <h5 className="mb-2 fw-bold">Incidencias por Código (Clic para ver documentos afectados)</h5>
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
