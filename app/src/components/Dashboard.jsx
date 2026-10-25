import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../utils/supabaseClient';
import { FiCheckCircle, FiAlertTriangle, FiXCircle, FiLayers } from 'react-icons/fi';

export default function Dashboard({ periodId, onNavigateToReconciliation, activeModule }) {
  const { data: stats = {
    total: 0,
    ok: 0,
    errors: 0,
    observed: 0,
    baseSap: 0,
    baseSunat: 0,
    igvSap: 0,
    igvSunat: 0,
    totalSap: 0,
    totalSunat: 0,
    countObs1: 0,
    countObs2: 0,
    countSapOk: 0,
    countSunatOk: 0,
  } } = useQuery({
    queryKey: ['dashboardStats', periodId, activeModule],
    queryFn: async () => {
      const summaryView = activeModule === 'compras' ? 'v_resumen_compras' : 'v_resumen_ventas';
      const detailTable = activeModule === 'compras' ? 'detalle_compras' : 'detalle_ventas';

      const [resumenRes, obs1Res, obs2Res, sapObsIdOkRes, sunatObsIdOkRes] = await Promise.all([
        supabase
          .from(summaryView)
          .select('*')
          .eq('periodo_id', periodId)
          .single(),
        supabase
          .from(detailTable)
          .select('*', { count: 'exact', head: true })
          .eq('periodo_id', periodId)
          .contains('errores_json', JSON.stringify([
            activeModule === 'compras' 
              ? 'OBS 6: RUC PROVEEDOR INVÁLIDO (SAP)' 
              : 'OBS 1: DIFERENCIA EN TIPO DE IDENTIDAD'
          ])),
        supabase
          .from(detailTable)
          .select('*', { count: 'exact', head: true })
          .eq('periodo_id', periodId)
          .contains('errores_json', JSON.stringify([
            activeModule === 'compras' 
              ? 'OBS 7: RUC PROVEEDOR INVÁLIDO (SUNAT)' 
              : 'OBS 2: DIFERENCIA EN NUMERO DE IDENTIDAD'
          ])),
        supabase
          .from(detailTable)
          .select('*', { count: 'exact', head: true })
          .eq('periodo_id', periodId)
          .eq('estado_validacion', 'OBSERVADO')
          .or('nro_identidad_sap.not.is.null,nombre_sap.not.is.null')
          .not('errores_json', 'cs', activeModule === 'compras' ? '["OBS 6: RUC PROVEEDOR INVÁLIDO (SAP)"]' : '["OBS 6: NÚMERO DE IDENTIDAD SAP INCORRECTO"]'),
        supabase
          .from(detailTable)
          .select('*', { count: 'exact', head: true })
          .eq('periodo_id', periodId)
          .eq('estado_validacion', 'OBSERVADO')
          .or('nro_identidad_sunat.not.is.null,nombre_sunat.not.is.null')
          .not('errores_json', 'cs', activeModule === 'compras' ? '["OBS 7: RUC PROVEEDOR INVÁLIDO (SUNAT)"]' : '["OBS 7: NÚMERO DE IDENTIDAD SUNAT INCORRECTO"]')
      ]);

      if (resumenRes.error && resumenRes.error.code !== 'PGRST116') {
        throw resumenRes.error;
      }
      if (sapObsIdOkRes.error) throw sapObsIdOkRes.error;
      if (sunatObsIdOkRes.error) throw sunatObsIdOkRes.error;

      const summary = resumenRes.data || {};

      return {
        total: parseInt(summary.total_registros) || 0,
        ok: parseInt(summary.ok_registros) || 0,
        errors: parseInt(summary.error_registros) || 0,
        observed: parseInt(summary.observado_registros) || 0,
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

  const getPercentage = (value) => {
    if (stats.total === 0) return '0%';
    return `${((value / stats.total) * 100).toFixed(1)}%`;
  };

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

      {/* KPI Cards Grid */}
      <div className="row g-3 mb-4">
        {/* Total Comprobantes */}
        <div className="col-xl-3 col-sm-6">
          <div 
            className="card-premium card-clickable d-flex align-items-center p-3 h-100"
            onClick={() => onNavigateToReconciliation && onNavigateToReconciliation('ALL')}
            title="Ver todos los comprobantes"
          >
            <div 
              className="rounded-3 p-3 me-3 d-flex align-items-center justify-content-center flex-shrink-0"
              style={{ width: '52px', height: '52px', backgroundColor: 'rgba(79, 70, 229, 0.1)', color: '#4F46E5', fontSize: '1.4rem' }}
            >
              <FiLayers />
            </div>
            <div className="text-truncate">
              <div className="text-muted fw-semibold" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                TOTAL COMPROBANTES
              </div>
              <h3 className="fw-bold mb-0 font-mono" style={{ color: 'var(--color-text)' }}>
                {stats.total.toLocaleString('es-PE')}
              </h3>
              <small className="text-muted" style={{ fontSize: '0.75rem' }}>100% de la carga procesada</small>
            </div>
          </div>
        </div>

        {/* Registros Correctos */}
        <div className="col-xl-3 col-sm-6">
          <div 
            className="card-premium card-clickable d-flex align-items-center p-3 h-100"
            onClick={() => onNavigateToReconciliation && onNavigateToReconciliation('OK')}
            title="Ver comprobantes correctos (OK)"
          >
            <div 
              className="rounded-3 p-3 me-3 d-flex align-items-center justify-content-center flex-shrink-0"
              style={{ width: '52px', height: '52px', backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#059669', fontSize: '1.4rem' }}
            >
              <FiCheckCircle />
            </div>
            <div className="text-truncate">
              <div className="text-muted fw-semibold" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                REGISTROS CORRECTOS
              </div>
              <h3 className="fw-bold mb-0 text-success font-mono">
                {stats.ok.toLocaleString('es-PE')}
              </h3>
              <small className="text-success font-mono fw-semibold" style={{ fontSize: '0.75rem' }}>
                {getPercentage(stats.ok)} del total
              </small>
            </div>
          </div>
        </div>

        {/* Observaciones */}
        <div className="col-xl-3 col-sm-6">
          <div 
            className="card-premium card-clickable d-flex align-items-center p-3 h-100"
            onClick={() => onNavigateToReconciliation && onNavigateToReconciliation('OBSERVADO')}
            title="Ver comprobantes observados"
          >
            <div 
              className="rounded-3 p-3 me-3 d-flex align-items-center justify-content-center flex-shrink-0"
              style={{ width: '52px', height: '52px', backgroundColor: 'rgba(217, 119, 6, 0.1)', color: '#D97706', fontSize: '1.4rem' }}
            >
              <FiAlertTriangle />
            </div>
            <div className="text-truncate">
              <div className="text-muted fw-semibold" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                OBSERVACIONES
              </div>
              <h3 className="fw-bold mb-0 text-warning font-mono">
                {stats.observed.toLocaleString('es-PE')}
              </h3>
              <small className="text-warning font-mono fw-semibold" style={{ fontSize: '0.75rem' }}>
                {getPercentage(stats.observed)} de advertencia
              </small>
            </div>
          </div>
        </div>

        {/* Errores / Discrepancias */}
        <div className="col-xl-3 col-sm-6">
          <div 
            className="card-premium card-clickable d-flex align-items-center p-3 h-100"
            onClick={() => onNavigateToReconciliation && onNavigateToReconciliation('ERROR')}
            title="Ver comprobantes con errores"
          >
            <div 
              className="rounded-3 p-3 me-3 d-flex align-items-center justify-content-center flex-shrink-0"
              style={{ width: '52px', height: '52px', backgroundColor: 'rgba(220, 38, 38, 0.1)', color: '#DC2626', fontSize: '1.4rem' }}
            >
              <FiXCircle />
            </div>
            <div className="text-truncate">
              <div className="text-muted fw-semibold" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                CON DISCREPANCIAS / ERROR
              </div>
              <h3 className="fw-bold mb-0 text-danger font-mono">
                {stats.errors.toLocaleString('es-PE')}
              </h3>
              <small className="text-danger font-mono fw-semibold" style={{ fontSize: '0.75rem' }}>
                {getPercentage(stats.errors)} críticos
              </small>
            </div>
          </div>
        </div>
      </div>

      <div className="row g-4">
        {/* Comparative Table */}
        <div className="col-lg-8">
          <div className="card-premium h-100 p-4">
            <h5 className="mb-3 fw-bold" style={{ color: 'var(--color-text)' }}>
              Comparativa Monetaria Lote (SAP vs. SUNAT)
            </h5>
            <div className="table-responsive">
              <table className="table table-hover table-dense align-middle mb-0">
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                    <th style={{ backgroundColor: 'var(--bg-surface)' }}>CONCEPTO</th>
                    <th className="text-end" style={{ backgroundColor: 'var(--bg-surface)' }}>SAP (S/.)</th>
                    <th className="text-end" style={{ backgroundColor: 'var(--bg-surface)' }}>SUNAT (S/.)</th>
                    <th className="text-end" style={{ backgroundColor: 'var(--bg-surface)' }}>DIFERENCIA (S/.)</th>
                    <th className="text-center" style={{ backgroundColor: 'var(--bg-surface)' }}>ESTADO</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="fw-semibold">Base Imponible</td>
                    <td className="text-end font-mono">{stats.baseSap.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</td>
                    <td className="text-end font-mono">{stats.baseSunat.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</td>
                    <td className={`text-end font-mono ${(stats.baseSap - stats.baseSunat) !== 0 ? 'text-danger fw-bold' : 'text-success'}`}>
                      {(stats.baseSap - stats.baseSunat).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="text-center">
                      {Math.abs(stats.baseSap - stats.baseSunat) <= 0.05 ? (
                        <span className="badge badge-status badge-status-ok">OK</span>
                      ) : (
                        <span className="badge badge-status badge-status-error">Discrepancia</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="fw-semibold">IGV / IPM</td>
                    <td className="text-end font-mono">{stats.igvSap.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</td>
                    <td className="text-end font-mono">{stats.igvSunat.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</td>
                    <td className={`text-end font-mono ${(stats.igvSap - stats.igvSunat) !== 0 ? 'text-danger fw-bold' : 'text-success'}`}>
                      {(stats.igvSap - stats.igvSunat).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="text-center">
                      {Math.abs(stats.igvSap - stats.igvSunat) <= 0.05 ? (
                        <span className="badge badge-status badge-status-ok">OK</span>
                      ) : (
                        <span className="badge badge-status badge-status-error">Discrepancia</span>
                      )}
                    </td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td className="fw-semibold">Total General</td>
                    <td className="text-end font-mono fw-bold">{stats.totalSap.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</td>
                    <td className="text-end font-mono fw-bold">{stats.totalSunat.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</td>
                    <td className={`text-end font-mono fw-bold ${(stats.totalSap - stats.totalSunat) !== 0 ? 'text-danger' : 'text-success'}`}>
                      {(stats.totalSap - stats.totalSunat).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="text-center">
                      {Math.abs(stats.totalSap - stats.totalSunat) <= 0.05 ? (
                        <span className="badge badge-status badge-status-ok">OK</span>
                      ) : (
                        <span className="badge badge-status badge-status-error">Discrepancia</span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Informative Side Panel */}
        <div className="col-lg-4">
          <div className="card-premium h-100 p-4 d-flex flex-column justify-content-between">
            <div>
              <h5 className="mb-3 fw-bold" style={{ color: 'var(--color-text)' }}>Estado del Lote</h5>
              <div className="text-center py-4">
                {stats.total === 0 ? (
                  <p className="text-muted mb-0">No hay datos procesados en este período.</p>
                ) : stats.errors > 0 ? (
                  <>
                    <FiXCircle className="text-danger mb-3" style={{ fontSize: '3rem' }} />
                    <h5 className="text-danger fw-bold">Requiere Corrección</h5>
                    <p className="text-muted" style={{ fontSize: '0.85rem' }}>
                      Se detectaron discrepancias de importes o infracciones a las reglas del DNI/RUC.
                    </p>
                  </>
                ) : stats.observed > 0 ? (
                  <>
                    <FiAlertTriangle className="text-warning mb-3" style={{ fontSize: '3rem' }} />
                    <h5 className="text-warning fw-bold">Con Observaciones</h5>
                    <p className="text-muted" style={{ fontSize: '0.85rem' }}>
                      El lote no tiene errores graves, pero cuenta con saltos de correlativos o advertencias.
                    </p>
                  </>
                ) : (
                  <>
                    <FiCheckCircle className="text-success mb-3" style={{ fontSize: '3rem' }} />
                    <h5 className="text-success fw-bold">Conciliado Correctamente</h5>
                    <p className="text-muted" style={{ fontSize: '0.85rem' }}>
                      Todos los registros coinciden perfectamente entre SAP, SUNAT y SIRE.
                    </p>
                  </>
                )}
              </div>
            </div>

            <div className="border-top pt-3" style={{ borderColor: 'var(--border-color)' }}>
              <div className="d-flex justify-content-between align-items-center mb-1">
                <span className="text-muted fw-semibold" style={{ fontSize: '0.8rem' }}>Tasa de Validación</span>
                <span className="font-mono fw-bold" style={{ color: 'var(--color-text)' }}>{getPercentage(stats.ok)}</span>
              </div>
              <div className="progress" style={{ height: '7px', backgroundColor: 'var(--bg-primary)', borderRadius: '4px' }}>
                <div 
                  className="progress-bar bg-success" 
                  role="progressbar" 
                  style={{ width: getPercentage(stats.ok) }}
                  aria-valuenow={stats.ok} 
                  aria-valuemin="0" 
                  aria-valuemax={stats.total}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Fila 2: Gráficos de Consistencia de Identidades */}
      <div className="row g-4 mt-1">
        {/* Gráfico de Barras de Comprobantes Correctos */}
        <div className="col-lg-6">
          <div className="card-premium h-100 p-4">
            <h5 className="mb-2 fw-bold" style={{ color: 'var(--color-text)' }}>
              Consistencia de Identidades en Observados
            </h5>
            <p className="text-muted mb-4" style={{ fontSize: '0.82rem' }}>
              Cantidad de comprobantes <strong>Observados</strong> con formato de identidad válido por origen. Haz clic en las barras para filtrar.
            </p>

            <div className="d-flex align-items-end justify-content-around mt-4 mb-3" style={{ height: '170px', paddingBottom: '10px', borderBottom: '1px solid var(--border-color)' }}>
              {/* Barra SAP */}
              <div 
                className="d-flex flex-column align-items-center justify-content-end h-100" 
                style={{ width: '130px' }}
              >
                <div 
                  className="bar-sap-glow animate-fade-in"
                  onClick={() => onNavigateToReconciliation && onNavigateToReconciliation('SAP_OBS_ID_OK')}
                  style={{
                    width: '54px',
                    height: `${stats.observed > 0 ? (stats.countSapOk / stats.observed * 100) : 0}%`,
                    background: 'linear-gradient(to top, #4f46e5, #8b5cf6)',
                    cursor: 'pointer',
                    borderRadius: '8px 8px 0 0',
                    transition: 'transform 0.2s ease',
                    boxShadow: '0 4px 10px rgba(79, 70, 229, 0.2)'
                  }}
                  title="Ver detalle de documentos observados con ID SAP válido"
                />
                <span className="fw-semibold mt-2" style={{ fontSize: '0.84rem', color: 'var(--color-text)' }}>
                  SAP (ID Válido)
                </span>
                <span className="font-mono text-muted" style={{ fontSize: '0.78rem' }}>
                  {stats.countSapOk} docs
                </span>
              </div>

              {/* Barra SUNAT */}
              <div 
                className="d-flex flex-column align-items-center justify-content-end h-100" 
                style={{ width: '130px' }}
              >
                <div 
                  className="bar-sunat-glow animate-fade-in"
                  onClick={() => onNavigateToReconciliation && onNavigateToReconciliation('SUNAT_OBS_ID_OK')}
                  style={{
                    width: '54px',
                    height: `${stats.observed > 0 ? (stats.countSunatOk / stats.observed * 100) : 0}%`,
                    background: 'linear-gradient(to top, #2563eb, #60a5fa)',
                    cursor: 'pointer',
                    borderRadius: '8px 8px 0 0',
                    transition: 'transform 0.2s ease',
                    boxShadow: '0 4px 10px rgba(37, 99, 235, 0.2)'
                  }}
                  title="Ver detalle de documentos observados con ID SUNAT válido"
                />
                <span className="fw-semibold mt-2" style={{ fontSize: '0.84rem', color: 'var(--color-text)' }}>
                  SUNAT (ID Válido)
                </span>
                <span className="font-mono text-muted" style={{ fontSize: '0.78rem' }}>
                  {stats.countSunatOk} docs
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Consistencia de Calidad de Datos de Identidades */}
        <div className="col-lg-6">
          <div className="card-premium h-100 p-4 d-flex flex-column justify-content-between">
            <div>
              <h5 className="mb-2 fw-bold" style={{ color: 'var(--color-text)' }}>
                {activeModule === 'compras' 
                  ? 'Calidad de Datos de Proveedores (RUC)' 
                  : 'Calidad de Datos de Identidades (RUC/DNI)'}
              </h5>
              <p className="text-muted mb-4" style={{ fontSize: '0.82rem' }}>
                {activeModule === 'compras'
                  ? 'Resumen de comprobantes con RUC de proveedor válido en SAP y SUNAT.'
                  : 'Resumen de comprobantes consistentes entre SAP y SUNAT para tipo y número de documento.'}
              </p>

              {/* Tipo de Identidad or SAP RUC Validity */}
              <div className="mb-4">
                <div className="d-flex justify-content-between align-items-center mb-1">
                  <span className="fw-semibold" style={{ fontSize: '0.85rem', color: 'var(--color-text)' }}>
                    {activeModule === 'compras' 
                      ? 'RUC Proveedor SAP Válido (Sin OBS 6)' 
                      : 'Tipo de Identidad Coincidente (Sin OBS 1)'}
                  </span>
                  <span className="badge font-mono" style={{ backgroundColor: 'rgba(37, 99, 235, 0.1)', color: '#2563EB', border: '1px solid rgba(37, 99, 235, 0.2)' }}>
                    {stats.total > 0 ? (((stats.total - stats.countObs1) / stats.total) * 100).toFixed(1) : 0}%
                  </span>
                </div>
                <div className="progress" style={{ height: '8px', backgroundColor: 'var(--bg-primary)', borderRadius: '4px' }}>
                  <div 
                    className="progress-bar bg-primary" 
                    role="progressbar" 
                    style={{ width: `${stats.total > 0 ? (((stats.total - stats.countObs1) / stats.total) * 100) : 0}%` }}
                  />
                </div>
                <div className="d-flex justify-content-between mt-1 text-muted" style={{ fontSize: '0.78rem' }}>
                  <span>Correctos: {stats.total - stats.countObs1} docs</span>
                  {stats.countObs1 > 0 && (
                    <span className="text-warning fw-semibold">
                      • {stats.countObs1} con discrepancias ({activeModule === 'compras' ? 'OBS 6' : 'OBS 1'})
                    </span>
                  )}
                </div>
              </div>

              {/* Número de Identidad or SUNAT RUC Validity */}
              <div className="mb-2">
                <div className="d-flex justify-content-between align-items-center mb-1">
                  <span className="fw-semibold" style={{ fontSize: '0.85rem', color: 'var(--color-text)' }}>
                    {activeModule === 'compras' 
                      ? 'RUC Proveedor SUNAT Válido (Sin OBS 7)' 
                      : 'Número de Identidad Coincidente (Sin OBS 2)'}
                  </span>
                  <span className="badge font-mono" style={{ backgroundColor: 'rgba(37, 99, 235, 0.1)', color: '#2563EB', border: '1px solid rgba(37, 99, 235, 0.2)' }}>
                    {stats.total > 0 ? (((stats.total - stats.countObs2) / stats.total) * 100).toFixed(1) : 0}%
                  </span>
                </div>
                <div className="progress" style={{ height: '8px', backgroundColor: 'var(--bg-primary)', borderRadius: '4px' }}>
                  <div 
                    className="progress-bar bg-primary" 
                    role="progressbar" 
                    style={{ width: `${stats.total > 0 ? (((stats.total - stats.countObs2) / stats.total) * 100) : 0}%` }}
                  />
                </div>
                <div className="d-flex justify-content-between mt-1 text-muted" style={{ fontSize: '0.78rem' }}>
                  <span>Correctos: {stats.total - stats.countObs2} docs</span>
                  {stats.countObs2 > 0 && (
                    <span className="text-warning fw-semibold">
                      • {stats.countObs2} con discrepancias ({activeModule === 'compras' ? 'OBS 7' : 'OBS 2'})
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
