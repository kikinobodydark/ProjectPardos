// ============================================================================
// Modal de detalle comparativo SAP vs SUNAT para el módulo de Compras (Sec. 7.D).
// Muestra la información de SAP y SUNAT lado a lado, resalta diferencias en
// fechas, importes, tipo de documento e identidad, y separa claramente los
// errores identificados de las observaciones generadas.
// ============================================================================
import React, { useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import { FiX, FiCheckCircle, FiAlertTriangle, FiXCircle, FiInfo } from 'react-icons/fi';
import {
  RESULTADOS_COMPRAS,
  CONCEPTOS_IMPORTE_COMPRAS,
  REGLAS_COMPRAS,
  TIPO,
  descripcionTipoDocCompras,
  descripcionTipoIdentidadCompras,
} from '../../utils/compras/catalogos';
import { formatoMonto } from '../../utils/ventas/montos';

const ModalDetalleDocumentoCompras = memo(function ModalDetalleDocumentoCompras({
  doc,
  onClose,
  onFiltrarCodigo,
}) {
  useEffect(() => {
    if (!doc) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [doc, onClose]);

  if (!doc) return null;

  const resInfo = RESULTADOS_COMPRAS[doc.resultado] || RESULTADOS_COMPRAS.OK;
  const ambos = doc.en_sap && doc.en_sunat;

  const diffFecha = ambos && (doc.sap?.fecha_emision || null) !== (doc.sunat?.fecha_emision || null);
  const diffTipoDoc = doc.codigosError.includes('ERROR 8');
  const diffTipoId = doc.codigosObs.includes('OBS 2');
  const diffNroId = doc.codigosObs.includes('OBS 3');
  const diffNombre =
    ambos &&
    (doc.sap?.nombre || '').trim().toUpperCase() !== (doc.sunat?.nombre || '').trim().toUpperCase();

  const filasImportes = CONCEPTOS_IMPORTE_COMPRAS.map((c) => {
    const s = doc.en_sap ? (doc.sap?.[c.campo] ?? 0) : null;
    const u = doc.en_sunat ? (doc.sunat?.[c.campo] ?? 0) : null;
    const dif = ambos ? s - u : null;
    const ok = dif === null ? null : dif === 0;
    return { ...c, sap: s, sunat: u, dif, ok };
  });

  const errores = (doc.incidencias || []).filter((i) => i.tipo === TIPO.ERROR);
  const observaciones = (doc.incidencias || []).filter((i) => i.tipo === TIPO.OBS);
  const notas = (doc.incidencias || []).filter((i) => i.tipo === TIPO.INFO);

  return createPortal(
    <div
      className="modal fade show d-block"
      tabIndex="-1"
      style={{ backgroundColor: 'rgba(15, 23, 42, 0.55)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}
    >
      <div
        className="modal-dialog modal-dialog-centered modal-xl modal-dialog-scrollable"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="modal-content rounded-3 p-3 p-md-4"
          style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}
        >
          {/* Encabezado */}
          <div
            className="d-flex justify-content-between align-items-start pb-3 mb-3 border-bottom"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <div>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <span className="badge font-mono" style={{ backgroundColor: '#F1F5F9', color: '#334155', fontSize: '0.78rem' }}>
                  {descripcionTipoDocCompras(doc.tipo_doc_pago)}
                </span>
                <h4 className="mb-0 fw-bold font-mono">
                  {doc.serie}-{doc.correlativo}
                </h4>
                <span className={`badge badge-status badge-status-${resInfo.clase}`}>
                  {resInfo.etiqueta}
                </span>
                {doc.tipo_doc_pago === '14' && doc.en_sap && !doc.en_sunat && (
                  <span className="badge" style={{ backgroundColor: 'rgba(5, 150, 105, 0.12)', color: '#047857' }}>
                    Excepción Tipo 14 (No migra a SUNAT)
                  </span>
                )}
              </div>
              <div className="text-muted mt-1" style={{ fontSize: '0.8rem' }}>
                Clave de validación:{' '}
                <strong className="font-mono text-dark">{doc.clave_legible}</strong>
                {doc.sap?.linea && (
                  <span className="ms-3">
                    Origen SAP: <strong className="font-mono">línea {doc.sap.linea}</strong>
                  </span>
                )}
                {doc.sunat?.linea && (
                  <span className="ms-3">
                    Origen SUNAT: <strong className="font-mono">línea {doc.sunat.linea}</strong>
                  </span>
                )}
              </div>
              {(doc.sap?.duplicado_en_origen || doc.sunat?.duplicado_en_origen) && (
                <div className="mt-1">
                  <span className="badge badge-status badge-status-observado" style={{ fontSize: '0.7rem' }}>
                    Registro con duplicados detectados en archivo de origen:
                    {doc.sap?.duplicado_en_origen ? ` SAP (líneas ${doc.sap.lineas_duplicadas?.join(', ')})` : ''}
                    {doc.sunat?.duplicado_en_origen ? ` SUNAT (líneas ${doc.sunat.lineas_duplicadas?.join(', ')})` : ''}
                  </span>
                </div>
              )}
            </div>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary border-0 fs-4 p-1"
              onClick={onClose}
              aria-label="Cerrar detalle"
            >
              <FiX />
            </button>
          </div>

          <div className="modal-body p-0">
            <div className="row g-3 mb-3">
              {/* 1. Datos Documentales e Identidad del Proveedor */}
              <div className="col-lg-6">
                <div
                  className="p-3 rounded-3 h-100"
                  style={{ backgroundColor: '#F8FAFC', border: '1px solid var(--border-color)' }}
                >
                  <div className="fw-bold mb-2" style={{ fontSize: '0.85rem' }}>
                    1. Datos del Documento y Proveedor (SAP vs. SUNAT)
                  </div>
                  <div className="table-responsive">
                    <table className="table table-sm table-dense mb-0">
                      <thead>
                        <tr>
                          <th>Campo</th>
                          <th>SAP</th>
                          <th>SUNAT</th>
                          <th className="text-center">Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="fw-semibold">Existencia</td>
                          <td className={!doc.en_sap ? 'cell-mismatch' : ''}>
                            {doc.en_sap ? (
                              <span className="text-success fw-semibold">Registrado</span>
                            ) : (
                              <span className="text-danger fw-bold">NO EXISTE EN SAP</span>
                            )}
                          </td>
                          <td className={!doc.en_sunat && doc.tipo_doc_pago !== '14' ? 'cell-mismatch' : ''}>
                            {doc.en_sunat ? (
                              <span className="text-success fw-semibold">Registrado</span>
                            ) : doc.tipo_doc_pago === '14' ? (
                              <span className="text-success fw-semibold">Exento (Tipo 14)</span>
                            ) : (
                              <span className="text-danger fw-bold">NO EXISTE EN SUNAT</span>
                            )}
                          </td>
                          <td className="text-center">
                            {ambos ? (
                              <FiCheckCircle className="text-success" />
                            ) : !doc.en_sunat && doc.tipo_doc_pago === '14' ? (
                              <span className="badge badge-status badge-status-ok">OK</span>
                            ) : !doc.en_sunat ? (
                              <span className="badge badge-status badge-status-error">ERROR 6</span>
                            ) : (
                              <span className="badge badge-status badge-status-observado">OBS 1</span>
                            )}
                          </td>
                        </tr>
                        <tr>
                          <td className="fw-semibold">Tipo Documento</td>
                          <td className={`font-mono ${diffTipoDoc && doc.en_sap ? 'cell-mismatch' : ''}`}>
                            {doc.en_sap ? descripcionTipoDocCompras(doc.sap.tipo_doc_pago) : '—'}
                          </td>
                          <td className={`font-mono ${diffTipoDoc && doc.en_sunat ? 'cell-mismatch' : ''}`}>
                            {doc.en_sunat ? descripcionTipoDocCompras(doc.sunat.tipo_doc_pago) : '—'}
                          </td>
                          <td className="text-center">
                            {diffTipoDoc ? (
                              <span className="badge badge-status badge-status-error">ERROR 8</span>
                            ) : (
                              <FiCheckCircle className="text-success" />
                            )}
                          </td>
                        </tr>
                        <tr>
                          <td className="fw-semibold">Serie / Correlativo</td>
                          <td className="font-mono">
                            {doc.en_sap ? `${doc.sap.serie}-${doc.sap.correlativo}` : '—'}
                          </td>
                          <td className="font-mono">
                            {doc.en_sunat ? `${doc.sunat.serie}-${doc.sunat.correlativo}` : '—'}
                          </td>
                          <td className="text-center">
                            {ambos ? <FiCheckCircle className="text-success" /> : '—'}
                          </td>
                        </tr>
                        <tr>
                          <td className="fw-semibold">Fecha de Emisión</td>
                          <td className={`font-mono ${diffFecha ? 'cell-mismatch' : ''}`}>
                            {doc.en_sap ? (doc.sap.fecha_emision || '(vacío)') : '—'}
                          </td>
                          <td className={`font-mono ${diffFecha ? 'cell-mismatch' : ''}`}>
                            {doc.en_sunat ? (doc.sunat.fecha_emision || '(vacío)') : '—'}
                          </td>
                          <td className="text-center">
                            {!ambos ? (
                              '—'
                            ) : diffFecha ? (
                              <span className="badge badge-status badge-status-error">ERROR 7</span>
                            ) : (
                              <FiCheckCircle className="text-success" />
                            )}
                          </td>
                        </tr>
                        <tr>
                          <td className="fw-semibold">Tipo de Identidad</td>
                          <td className={`font-mono ${diffTipoId ? 'cell-mismatch' : ''}`}>
                            {doc.en_sap ? descripcionTipoIdentidadCompras(doc.sap.tipo_identidad) : '—'}
                          </td>
                          <td className={`font-mono ${diffTipoId ? 'cell-mismatch' : ''}`}>
                            {doc.en_sunat ? descripcionTipoIdentidadCompras(doc.sunat.tipo_identidad) : '—'}
                          </td>
                          <td className="text-center">
                            {!ambos ? (
                              '—'
                            ) : diffTipoId ? (
                              <span className="badge badge-status badge-status-observado">OBS 2</span>
                            ) : (
                              <FiCheckCircle className="text-success" />
                            )}
                          </td>
                        </tr>
                        <tr>
                          <td className="fw-semibold">N° Identidad / RUC</td>
                          <td className={`font-mono ${diffNroId ? 'cell-mismatch' : ''}`}>
                            {doc.en_sap ? (doc.sap.nro_identidad || '(vacío)') : '—'}
                          </td>
                          <td className={`font-mono ${diffNroId ? 'cell-mismatch' : ''}`}>
                            {doc.en_sunat ? (doc.sunat.nro_identidad || '(vacío)') : '—'}
                          </td>
                          <td className="text-center">
                            {!ambos ? (
                              '—'
                            ) : diffNroId ? (
                              <span className="badge badge-status badge-status-observado">OBS 3</span>
                            ) : (
                              <FiCheckCircle className="text-success" />
                            )}
                          </td>
                        </tr>
                        <tr>
                          <td className="fw-semibold">Razón Social</td>
                          <td className={diffNombre ? 'text-warning fw-semibold' : ''} style={{ whiteSpace: 'normal' }}>
                            {doc.en_sap ? (doc.sap.nombre || '—') : '—'}
                          </td>
                          <td className={diffNombre ? 'text-warning fw-semibold' : ''} style={{ whiteSpace: 'normal' }}>
                            {doc.en_sunat ? (doc.sunat.nombre || '—') : '—'}
                          </td>
                          <td className="text-center">
                            {!ambos ? '—' : diffNombre ? <span className="text-muted">Informativo</span> : <FiCheckCircle className="text-success" />}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* 2. Comparativa de Importes Económicos */}
              <div className="col-lg-6">
                <div
                  className="p-3 rounded-3 h-100"
                  style={{ backgroundColor: '#F8FAFC', border: '1px solid var(--border-color)' }}
                >
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <span className="fw-bold" style={{ fontSize: '0.85rem' }}>
                      2. Comparativa de Importes (Precisión Decimal Exacta)
                    </span>
                    <span className="text-muted font-mono" style={{ fontSize: '0.75rem' }}>Moneda: PEN (S/)</span>
                  </div>
                  <div className="table-responsive">
                    <table className="table table-sm table-dense mb-0">
                      <thead>
                        <tr>
                          <th>Concepto</th>
                          <th className="text-end">SAP</th>
                          <th className="text-end">SUNAT</th>
                          <th className="text-end">Diferencia</th>
                          <th className="text-center">Resultado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filasImportes.map((f) => (
                          <tr key={f.campo}>
                            <td className="fw-semibold">{f.concepto}</td>
                            <td className={`text-end font-mono ${f.ok === false ? 'cell-mismatch' : ''}`}>
                              {doc.en_sap ? formatoMonto(f.sap) : '—'}
                            </td>
                            <td className={`text-end font-mono ${f.ok === false ? 'cell-mismatch' : ''}`}>
                              {doc.en_sunat ? formatoMonto(f.sunat) : '—'}
                            </td>
                            <td
                              className={`text-end font-mono ${
                                f.ok === false ? 'cell-mismatch' : f.dif === 0 ? 'text-muted' : ''
                              }`}
                            >
                              {f.dif === null ? '—' : formatoMonto(f.dif)}
                            </td>
                            <td className="text-center">
                              {f.ok === null ? (
                                <span className="text-muted">N/A</span>
                              ) : f.ok ? (
                                <span className="badge badge-status badge-status-ok">OK</span>
                              ) : (
                                <span className="badge badge-status badge-status-error">{f.codigo}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            {/* 3. Errores Identificados y Observaciones Generadas (separados explícitamente) */}
            <div className="row g-3">
              <div className="col-lg-6">
                <div
                  className="p-3 rounded-3 h-100"
                  style={{ backgroundColor: '#F8FAFC', border: '1px solid var(--border-color)' }}
                >
                  <div className="fw-bold mb-2 d-flex align-items-center gap-1 text-danger" style={{ fontSize: '0.85rem' }}>
                    <FiXCircle /> Errores Identificados ({errores.length})
                  </div>
                  {errores.length === 0 ? (
                    <div className="text-success fw-semibold d-flex align-items-center" style={{ fontSize: '0.82rem' }}>
                      <FiCheckCircle className="me-2" /> Sin errores detectados en este documento.
                    </div>
                  ) : (
                    <div className="d-flex flex-column gap-2">
                      {errores.map((inc, idx) => (
                        <div
                          key={`err-${idx}`}
                          className="p-2 rounded-2 d-flex align-items-start justify-content-between gap-2"
                          style={{ backgroundColor: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)' }}
                        >
                          <div>
                            <div className="d-flex align-items-center gap-2 flex-wrap">
                              <span className="badge badge-status badge-status-error">{inc.codigo}</span>
                              <strong style={{ fontSize: '0.82rem' }}>{inc.descripcion}</strong>
                            </div>
                            <div className="mt-1" style={{ fontSize: '0.8rem' }}>{inc.detalle}</div>
                            {inc.regla && (
                              <small className="font-mono text-muted" style={{ fontSize: '0.71rem' }}>
                                [{inc.regla}{REGLAS_COMPRAS[inc.regla] ? `: ${REGLAS_COMPRAS[inc.regla]}` : ''}]
                              </small>
                            )}
                          </div>
                          {onFiltrarCodigo && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-danger py-0 px-2 flex-shrink-0"
                              style={{ fontSize: '0.72rem' }}
                              onClick={() => {
                                onFiltrarCodigo(inc.codigo);
                                onClose();
                              }}
                            >
                              Ver todos
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="col-lg-6">
                <div
                  className="p-3 rounded-3 h-100"
                  style={{ backgroundColor: '#F8FAFC', border: '1px solid var(--border-color)' }}
                >
                  <div className="fw-bold mb-2 d-flex align-items-center gap-1 text-warning" style={{ fontSize: '0.85rem' }}>
                    <FiAlertTriangle /> Observaciones Generadas ({observaciones.length})
                  </div>
                  {observaciones.length === 0 ? (
                    <div className="text-success fw-semibold d-flex align-items-center" style={{ fontSize: '0.82rem' }}>
                      <FiCheckCircle className="me-2" /> Sin observaciones registradas en este documento.
                    </div>
                  ) : (
                    <div className="d-flex flex-column gap-2">
                      {observaciones.map((inc, idx) => (
                        <div
                          key={`obs-${idx}`}
                          className="p-2 rounded-2 d-flex align-items-start justify-content-between gap-2"
                          style={{ backgroundColor: 'rgba(217,119,6,0.07)', border: '1px solid rgba(217,119,6,0.22)' }}
                        >
                          <div>
                            <div className="d-flex align-items-center gap-2 flex-wrap">
                              <span className="badge badge-status badge-status-observado">{inc.codigo}</span>
                              <strong style={{ fontSize: '0.82rem' }}>{inc.descripcion}</strong>
                            </div>
                            <div className="mt-1" style={{ fontSize: '0.8rem' }}>{inc.detalle}</div>
                            {inc.regla && (
                              <small className="font-mono text-muted" style={{ fontSize: '0.71rem' }}>
                                [{inc.regla}{REGLAS_COMPRAS[inc.regla] ? `: ${REGLAS_COMPRAS[inc.regla]}` : ''}]
                              </small>
                            )}
                          </div>
                          {onFiltrarCodigo && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-warning py-0 px-2 flex-shrink-0"
                              style={{ fontSize: '0.72rem' }}
                              onClick={() => {
                                onFiltrarCodigo(inc.codigo);
                                onClose();
                              }}
                            >
                              Ver todos
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {notas.length > 0 && (
                    <div className="mt-2 pt-2 border-top" style={{ borderColor: 'var(--border-color)' }}>
                      {notas.map((n, i) => (
                        <div key={`info-${i}`} className="d-flex align-items-start gap-2 text-muted" style={{ fontSize: '0.78rem' }}>
                          <FiInfo className="text-primary flex-shrink-0 mt-1" />
                          <span>
                            <strong>{n.descripcion}:</strong> {n.detalle}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
});

export default ModalDetalleDocumentoCompras;
