import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../utils/supabaseClient';
import { FiCheckCircle, FiAlertTriangle, FiXCircle, FiLayers } from 'react-icons/fi';

export default function Dashboard({ periodId, onNavigateToReconciliation }) {
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
  } } = useQuery({
    queryKey: ['dashboardStats', periodId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_resumen_validacion')
        .select('*')
        .eq('periodo_id', periodId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return {
            total: 0, ok: 0, errors: 0, observed: 0,
            baseSap: 0, baseSunat: 0, igvSap: 0, igvSunat: 0, totalSap: 0, totalSunat: 0
          };
        }
        throw error;
      }

      if (data) {
        return {
          total: parseInt(data.total_registros) || 0,
          ok: parseInt(data.ok_registros) || 0,
          errors: parseInt(data.error_registros) || 0,
          observed: parseInt(data.observado_registros) || 0,
          baseSap: parseFloat(data.sum_base_sap) || 0,
          baseSunat: parseFloat(data.sum_base_sunat) || 0,
          igvSap: parseFloat(data.sum_igv_sap) || 0,
          igvSunat: parseFloat(data.sum_igv_sunat) || 0,
          totalSap: parseFloat(data.sum_total_sap) || 0,
          totalSunat: parseFloat(data.sum_total_sunat) || 0,
        };
      }
      return {
        total: 0, ok: 0, errors: 0, observed: 0,
        baseSap: 0, baseSunat: 0, igvSap: 0, igvSunat: 0, totalSap: 0, totalSunat: 0
      };
    },
    enabled: !!periodId,
  });

  const getPercentage = (value) => {
    if (stats.total === 0) return '0%';
    return `${((value / stats.total) * 100).toFixed(1)}%`;
  };

  return (
    <div className="animate-fade-in">
      <h3 className="mb-4 fw-bold">Panel Resumen Ejecutivo</h3>

      {/* KPI Cards Grid */}
      <div className="row g-3 mb-4">
        <div className="col-xl-3 col-sm-6">
          <div 
            className="card-premium card-clickable d-flex align-items-center"
            onClick={() => onNavigateToReconciliation && onNavigateToReconciliation('ALL')}
          >
            <div className="bg-secondary bg-opacity-25 rounded-3 p-3 me-3 text-secondary fs-3">
              <FiLayers />
            </div>
            <div>
              <div className="text-muted" style={{ fontSize: '0.78rem' }}>TOTAL COMPROBANTES</div>
              <h3 className="fw-bold mb-0 font-mono">{stats.total}</h3>
              <small className="text-muted">100% de la carga</small>
            </div>
          </div>
        </div>

        <div className="col-xl-3 col-sm-6">
          <div 
            className="card-premium card-clickable d-flex align-items-center"
            onClick={() => onNavigateToReconciliation && onNavigateToReconciliation('OK')}
          >
            <div className="bg-success bg-opacity-25 rounded-3 p-3 me-3 text-success fs-3">
              <FiCheckCircle />
            </div>
            <div>
              <div className="text-muted" style={{ fontSize: '0.78rem' }}>REGISTROS CORRECTOS</div>
              <h3 className="fw-bold mb-0 text-success font-mono">{stats.ok}</h3>
              <small className="text-success font-mono">{getPercentage(stats.ok)} del total</small>
            </div>
          </div>
        </div>

        <div className="col-xl-3 col-sm-6">
          <div 
            className="card-premium card-clickable d-flex align-items-center"
            onClick={() => onNavigateToReconciliation && onNavigateToReconciliation('OBSERVADO')}
          >
            <div className="bg-warning bg-opacity-25 rounded-3 p-3 me-3 text-warning fs-3">
              <FiAlertTriangle />
            </div>
            <div>
              <div className="text-muted" style={{ fontSize: '0.78rem' }}>OBSERVACIONES</div>
              <h3 className="fw-bold mb-0 text-warning font-mono">{stats.observed}</h3>
              <small className="text-warning font-mono">{getPercentage(stats.observed)} de advertencia</small>
            </div>
          </div>
        </div>

        <div className="col-xl-3 col-sm-6">
          <div 
            className="card-premium card-clickable d-flex align-items-center"
            onClick={() => onNavigateToReconciliation && onNavigateToReconciliation('ERROR')}
          >
            <div className="bg-danger bg-opacity-25 rounded-3 p-3 me-3 text-danger fs-3">
              <FiXCircle />
            </div>
            <div>
              <div className="text-muted" style={{ fontSize: '0.78rem' }}>CON DISCREPANCIAS / ERROR</div>
              <h3 className="fw-bold mb-0 text-danger font-mono">{stats.errors}</h3>
              <small className="text-danger font-mono">{getPercentage(stats.errors)} críticos</small>
            </div>
          </div>
        </div>
      </div>

      <div className="row g-4">
        {/* Comparative Table */}
        <div className="col-lg-8">
          <div className="card-premium h-100">
            <h5 className="mb-3 fw-bold">Comparativa Monetaria Lote (SAP vs. SUNAT)</h5>
            <div className="table-responsive">
              <table className="table table-hover table-borderless table-dense align-middle mb-0 text-white-on-dark-only">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <th>CONCEPTO</th>
                    <th className="text-end">SAP (S/.)</th>
                    <th className="text-end">SUNAT (S/.)</th>
                    <th className="text-end">DIFERENCIA (S/.)</th>
                    <th className="text-center">ESTADO</th>
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
          <div className="card-premium h-100 d-flex flex-column justify-content-between">
            <div>
              <h5 className="mb-3 fw-bold">Estado de Lote</h5>
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
                <span className="text-muted" style={{ fontSize: '0.8rem' }}>Tasa de Validación</span>
                <span className="text-white font-mono fw-semibold">{getPercentage(stats.ok)}</span>
              </div>
              <div className="progress" style={{ height: '6px', backgroundColor: 'var(--bg-primary)' }}>
                <div 
                  className="progress-bar bg-success" 
                  role="progressbar" 
                  style={{ width: getPercentage(stats.ok) }}
                  aria-valuenow={stats.ok} 
                  aria-valuemin="0" 
                  aria-valuemax={stats.total}
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
