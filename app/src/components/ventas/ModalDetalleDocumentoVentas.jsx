// ============================================================================
// Modal de detalle comparativo SAP vs SUNAT de un comprobante (Sección 10).
// Muestra los valores de ambos sistemas, las diferencias por concepto, la
// evaluación de identidad, cortesías y la trazabilidad de cada regla aplicada.
// ============================================================================
import React, { useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import { FiX, FiCheckCircle, FiAlertTriangle, FiGift, FiMapPin } from 'react-icons/fi';
import { ESTADOS, REGLAS, descripcionTipoCP, descripcionTipoIdentidad } from '../../utils/ventas/catalogos';
import { formatoMonto, dentroDeTolerancia } from '../../utils/ventas/montos';
import { CONCEPTOS_IMPORTE } from '../../utils/ventas/reglas';
import { obtenerEvaluacionIdentidad } from '../../utils/ventas/reportes';
import { parsearCorrelativoBigInt, generarCorrelativosFaltantes } from '../../utils/ventas/documento';
import { BadgeSistemaSalto, ListaCorrelativosFaltantes } from './PanelSaltosSecuenciaVentas';

const ModalDetalleDocumentoVentas = memo(function ModalDetalleDocumentoVentas({
  doc, localNombre, onClose, onFiltrarCodigo, onSelectDoc,
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
  const esFaltante = !!doc.esFaltanteSecuencia;
  const est = ESTADOS[doc.estado] || ESTADOS.OK;
  const evId = esFaltante ? null : obtenerEvaluacionIdentidad(doc);

  const filasImportes = CONCEPTOS_IMPORTE.map((c) => {
    const s = doc.en_sap ? doc.sap[c.campo] : null;
    const u = doc.en_sunat ? doc.sunat[c.campo] : null;
    const dif = doc.en_sap && doc.en_sunat ? s - u : null;
    const ok = dif === null ? null : dentroDeTolerancia(dif);
    return { ...c, sap: s, sunat: u, dif, ok };
  });

  const diffTipoId = doc.en_sap && doc.en_sunat && doc.sap.tipo_identidad !== doc.sunat.tipo_identidad;
  const diffNroId = doc.en_sap && doc.en_sunat && doc.sap.nro_identidad !== doc.sunat.nro_identidad;
  const diffNombre = doc.en_sap && doc.en_sunat && (doc.sap.nombre || '').trim() !== (doc.sunat.nombre || '').trim();

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
          <div className="d-flex justify-content-between align-items-start pb-3 mb-3 border-bottom" style={{ borderColor: 'var(--border-color)' }}>
            <div>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <span className="badge font-mono" style={{ backgroundColor: '#F1F5F9', color: '#334155', fontSize: '0.78rem' }}>
                  {doc.tipo_doc_pago} · {descripcionTipoCP(doc.tipo_doc_pago)}
                </span>
                <h4 className="mb-0 fw-bold font-mono">
                  {doc.serie}-{doc.correlativo}
                </h4>
                <span className={`badge badge-status badge-status-${est.clase}`}>
                  {esFaltante ? 'CORRELATIVO FALTANTE' : est.etiqueta}
                </span>
                {esFaltante && doc.saltoMeta?.sistema && (
                  <BadgeSistemaSalto sistema={doc.saltoMeta.sistema} />
                )}
                {localNombre && (
                  <span
                    className="badge d-inline-flex align-items-center gap-1"
                    style={{ backgroundColor: 'rgba(37, 99, 235, 0.1)', color: '#1D4ED8', fontSize: '0.75rem' }}
                  >
                    <FiMapPin size={11} /> {localNombre}
                  </span>
                )}
                {doc.anulado && (
                  <span className="badge bg-secondary">ANULADO (Est. 2)</span>
                )}
                {doc.cortesia && (
                  <span className="badge" style={{ backgroundColor: 'rgba(124, 58, 237, 0.12)', color: '#6D28D9' }}>
                    <FiGift className="me-1" /> Cortesía ({doc.cortesia.resultado})
                  </span>
                )}
              </div>
              <div className="text-muted mt-1" style={{ fontSize: '0.82rem' }}>
                {esFaltante ? (
                  <>
                    Comprobante no encontrado en la secuencia de <strong>{doc.saltoMeta?.sistema_etiqueta}</strong>
                    {' · '}Salto entre{' '}
                    <strong className="font-mono">{doc.serie}-{doc.saltoMeta?.anterior}</strong> ({doc.saltoMeta?.fecha_anterior || 's/f'})
                    {' y '}
                    <strong className="font-mono">{doc.serie}-{doc.saltoMeta?.siguiente}</strong> ({doc.saltoMeta?.fecha_siguiente || 's/f'})
                  </>
                ) : (
                  <>
                    Fecha de emisión: <strong className="font-mono">{doc.fecha_emision || '—'}</strong>
                    {doc.sap && (
                      <span className="ms-3">
                        Folio original SAP: <strong className="font-mono">{doc.serie}-{doc.sap.correlativo}</strong>
                        {doc.sap.linea ? ` (línea ${doc.sap.linea})` : ''}
                      </span>
                    )}
                    {doc.sunat && (
                      <span className="ms-3">
                        Folio original SUNAT: <strong className="font-mono">{doc.serie}-{doc.sunat.correlativo}</strong>
                        {doc.sunat.linea ? ` (línea ${doc.sunat.linea})` : ''}
                      </span>
                    )}
                  </>
                )}
              </div>
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
            {/* 1. Comparación de Identidad SAP vs SUNAT */}
            <div className="row g-3 mb-3">
              <div className="col-lg-6">
                <div className="p-3 rounded-3 h-100" style={{ backgroundColor: '#F8FAFC', border: '1px solid var(--border-color)' }}>
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <span className="fw-bold" style={{ fontSize: '0.85rem' }}>
                      1. Identificación del Cliente (SAP vs. SUNAT)
                    </span>
                    {evId && (
                      <span className="badge font-mono" style={{
                        backgroundColor: evId.sistema_correcto === 'AMBOS' ? 'rgba(5,150,105,0.12)' : evId.sistema_correcto === 'NINGUNO' ? 'rgba(220,38,38,0.12)' : 'rgba(217,119,6,0.12)',
                        color: evId.sistema_correcto === 'AMBOS' ? '#047857' : evId.sistema_correcto === 'NINGUNO' ? '#B91C1C' : '#B45309',
                      }}>
                        Dato correcto: {evId.sistema_correcto}
                      </span>
                    )}
                  </div>
                  <div className="table-responsive">
                    <table className="table table-sm table-dense mb-0">
                      <thead>
                        <tr>
                          <th>Campo</th>
                          <th>SAP</th>
                          <th>SUNAT</th>
                          <th className="text-center">Cruce</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="fw-semibold">Existencia</td>
                          {esFaltante ? (
                            <>
                              <td>
                                {doc.saltoMeta?.sistema === 'SAP' || doc.saltoMeta?.sistema === 'AMBOS' ? (
                                  <span className="text-danger fw-bold">FALTANTE EN SAP</span>
                                ) : (
                                  <span className="text-muted">N/A</span>
                                )}
                              </td>
                              <td>
                                {doc.saltoMeta?.sistema === 'SUNAT' || doc.saltoMeta?.sistema === 'AMBOS' ? (
                                  <span className="text-danger fw-bold">FALTANTE EN SUNAT</span>
                                ) : (
                                  <span className="text-muted">N/A</span>
                                )}
                              </td>
                              <td className="text-center"><span className="text-muted">N/A</span></td>
                            </>
                          ) : (
                            <>
                              <td>{doc.en_sap ? <span className="text-success fw-semibold">Registrado</span> : <span className="text-danger fw-bold">NO EXISTE EN SAP</span>}</td>
                              <td>{doc.en_sunat ? <span className="text-success fw-semibold">Registrado</span> : <span className="text-danger fw-bold">NO EXISTE EN SUNAT</span>}</td>
                              <td className="text-center">{doc.en_sap && doc.en_sunat ? <FiCheckCircle className="text-success" /> : <FiAlertTriangle className="text-warning" />}</td>
                            </>
                          )}
                        </tr>
                        <tr>
                          <td className="fw-semibold">Tipo Identidad</td>
                          <td className={`font-mono ${diffTipoId ? 'cell-mismatch' : ''}`}>
                            {esFaltante ? <span className="text-muted">N/A</span> : doc.en_sap ? descripcionTipoIdentidad(doc.sap.tipo_identidad) : '—'}
                          </td>
                          <td className={`font-mono ${diffTipoId ? 'cell-mismatch' : ''}`}>
                            {esFaltante ? <span className="text-muted">N/A</span> : doc.en_sunat ? descripcionTipoIdentidad(doc.sunat.tipo_identidad) : '—'}
                          </td>
                          <td className="text-center">
                            {esFaltante ? <span className="text-muted">N/A</span> : !doc.en_sap || !doc.en_sunat ? '—' : diffTipoId ? <span className="badge badge-status badge-status-observado">OBS 1</span> : <FiCheckCircle className="text-success" />}
                          </td>
                        </tr>
                        <tr>
                          <td className="fw-semibold">N° Identidad</td>
                          <td className={`font-mono ${diffNroId ? 'cell-mismatch' : ''}`}>
                            {esFaltante ? <span className="text-muted">N/A</span> : doc.en_sap ? (doc.sap.nro_identidad || '(vacío)') : '—'}
                          </td>
                          <td className={`font-mono ${diffNroId ? 'cell-mismatch' : ''}`}>
                            {esFaltante ? <span className="text-muted">N/A</span> : doc.en_sunat ? (doc.sunat.nro_identidad || '(vacío)') : '—'}
                          </td>
                          <td className="text-center">
                            {esFaltante ? <span className="text-muted">N/A</span> : !doc.en_sap || !doc.en_sunat ? '—' : diffNroId ? <span className="badge badge-status badge-status-observado">OBS 2</span> : <FiCheckCircle className="text-success" />}
                          </td>
                        </tr>
                        <tr>
                          <td className="fw-semibold">Nombre / Razón Social</td>
                          <td className={diffNombre ? 'text-warning fw-semibold' : ''} style={{ whiteSpace: 'normal' }}>
                            {esFaltante ? <span className="text-muted">N/A</span> : doc.en_sap ? (doc.sap.nombre || '—') : '—'}
                          </td>
                          <td className={diffNombre ? 'text-warning fw-semibold' : ''} style={{ whiteSpace: 'normal' }}>
                            {esFaltante ? <span className="text-muted">N/A</span> : doc.en_sunat ? (doc.sunat.nombre || '—') : '—'}
                          </td>
                          <td className="text-center">
                            {esFaltante ? <span className="text-muted">N/A</span> : !doc.en_sap || !doc.en_sunat ? '—' : diffNombre ? <span className="text-muted">Distinto</span> : <FiCheckCircle className="text-success" />}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {evId && (
                    <div className="mt-2 pt-2 border-top" style={{ fontSize: '0.78rem', borderColor: 'var(--border-color)' }}>
                      <div className="row g-2">
                        <div className="col-6">
                          <div className="fw-semibold text-muted mb-1">Evaluación reglas en SAP:</div>
                          {!doc.en_sap ? <span className="text-muted">No existe en SAP</span> :
                            evId.sap?.length ? evId.sap.map((e, i) => (
                              <div key={i} className={e.ok ? 'text-success' : 'text-danger fw-semibold'}>
                                {e.ok ? '✓' : '✗'} [{e.regla}] {e.nombre}: {e.motivo}
                              </div>
                            )) : <span className="text-muted">Sin reglas específicas para este tipo</span>}
                        </div>
                        <div className="col-6">
                          <div className="fw-semibold text-muted mb-1">Evaluación reglas en SUNAT:</div>
                          {!doc.en_sunat ? <span className="text-muted">No existe en SUNAT</span> :
                            evId.sunat?.length ? evId.sunat.map((e, i) => (
                              <div key={i} className={e.ok ? 'text-success' : 'text-danger fw-semibold'}>
                                {e.ok ? '✓' : '✗'} [{e.regla}] {e.nombre}: {e.motivo}
                              </div>
                            )) : <span className="text-muted">Sin reglas específicas para este tipo</span>}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 2. Comparación de Importes por Concepto */}
              <div className="col-lg-6">
                <div className="p-3 rounded-3 h-100" style={{ backgroundColor: '#F8FAFC', border: '1px solid var(--border-color)' }}>
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <span className="fw-bold" style={{ fontSize: '0.85rem' }}>
                      2. Comparación de Importes (Tolerancia: S/ 0.05)
                    </span>
                    <span className="text-muted font-mono" style={{ fontSize: '0.75rem' }}>Moneda: PEN (S/)</span>
                  </div>
                  <div className="table-responsive">
                    <table className="table table-sm table-dense mb-0">
                      <thead>
                        <tr>
                          <th>Concepto</th>
                          <th className="text-end">Importe SAP</th>
                          <th className="text-end">Importe SUNAT</th>
                          <th className="text-end">Diferencia</th>
                          <th className="text-center">Resultado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filasImportes.map((f) => (
                          <tr key={f.campo}>
                            <td className="fw-semibold">{f.concepto}</td>
                            <td className="text-end font-mono">{doc.en_sap ? formatoMonto(f.sap) : '—'}</td>
                            <td className="text-end font-mono">{doc.en_sunat ? formatoMonto(f.sunat) : '—'}</td>
                            <td className={`text-end font-mono ${f.ok === false ? 'cell-mismatch' : f.dif === 0 ? 'text-muted' : 'text-success'}`}>
                              {f.dif === null ? '—' : formatoMonto(f.dif)}
                            </td>
                            <td className="text-center">
                              {f.ok === null ? (
                                <span className="text-muted">N/A</span>
                              ) : f.ok ? (
                                <span className="badge badge-status badge-status-ok">Correcto</span>
                              ) : (
                                <span className="badge badge-status badge-status-error">{f.codigo}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                        {doc.sunat?.op_gratuitas > 0 && (
                          <tr>
                            <td className="text-muted">Valor Op. Gratuitas (SUNAT)</td>
                            <td className="text-end font-mono text-muted">—</td>
                            <td className="text-end font-mono">{formatoMonto(doc.sunat.op_gratuitas)}</td>
                            <td className="text-end font-mono text-muted">—</td>
                            <td className="text-center"><span className="text-muted" style={{ fontSize: '0.72rem' }}>Informativo</span></td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {doc.cortesia && (
                    <div className="mt-2 pt-2 border-top" style={{ fontSize: '0.78rem', borderColor: 'var(--border-color)' }}>
                      <div className="fw-semibold mb-1">
                        <FiGift className="me-1" /> Validación de Cortesía [{doc.cortesia.regla}]:{' '}
                        <span className={doc.cortesia.resultado === 'CORRECTA' ? 'text-success' : 'text-danger'}>
                          {doc.cortesia.resultado}
                        </span>
                      </div>
                      {doc.cortesia.excel && (
                        <div className="text-muted">
                          Excel Cortesías: <strong>{doc.cortesia.excel.detalle}</strong> — {doc.cortesia.excel.observacion}
                        </div>
                      )}
                      {doc.cortesia.motivos?.length > 0 && (
                        <div className="text-danger">{doc.cortesia.motivos.join(' · ')}</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 3. Trazabilidad de Reglas e Incidencias */}
            <div className="p-3 rounded-3" style={{ backgroundColor: '#F8FAFC', border: '1px solid var(--border-color)' }}>
              <div className="fw-bold mb-2" style={{ fontSize: '0.85rem' }}>
                3. Motivo de Clasificación y Trazabilidad de Reglas ({doc.incidencias.length})
              </div>
              {doc.incidencias.length === 0 ? (
                <div className="text-success fw-semibold d-flex align-items-center" style={{ fontSize: '0.85rem' }}>
                  <FiCheckCircle className="me-2" />
                  Comprobante CORRECTO: coincide en SAP y SUNAT, importes dentro de S/ 0.05, identidad válida y secuencia continua.
                </div>
              ) : (
                <div className="d-flex flex-column gap-2">
                  {doc.incidencias.map((inc, idx) => {
                    const esErr = inc.tipo === 'ERROR';
                    const esObs = inc.tipo === 'OBS';
                    const esObs3 = inc.codigo === 'OBS 3';
                    let obs3Faltantes = inc.datos?.correlativos_faltantes || [];
                    let obs3Total = inc.datos?.faltantes || obs3Faltantes.length;
                    let obs3Rango = inc.datos?.rango_faltante || '';
                    let obs3Truncado = !!inc.datos?.faltantes_truncado;
                    if (esObs3 && obs3Faltantes.length === 0 && inc.datos?.anterior && inc.datos?.siguiente) {
                      const aNum = parsearCorrelativoBigInt(inc.datos.anterior);
                      const bNum = parsearCorrelativoBigInt(inc.datos.siguiente);
                      if (aNum !== null && bNum !== null && bNum - aNum > 1n) {
                        const gen = generarCorrelativosFaltantes(aNum + 1n, bNum - 1n, inc.datos.anterior, inc.datos.siguiente, 50);
                        obs3Faltantes = gen.lista;
                        obs3Total = gen.total;
                        obs3Rango = gen.rangoTexto;
                        obs3Truncado = gen.truncado;
                      }
                    }
                    return (
                      <div
                        key={idx}
                        className="p-2 rounded-2 d-flex align-items-start justify-content-between gap-2"
                        style={{
                          backgroundColor: esErr ? 'rgba(220,38,38,0.06)' : esObs ? 'rgba(217,119,6,0.07)' : '#FFFFFF',
                          border: `1px solid ${esErr ? 'rgba(220,38,38,0.2)' : esObs ? 'rgba(217,119,6,0.22)' : 'var(--border-color)'}`,
                        }}
                      >
                        <div>
                          <div className="d-flex align-items-center gap-2 flex-wrap">
                            <span className={`badge badge-status badge-status-${esErr ? 'error' : esObs ? 'observado' : 'ok'}`}>
                              {inc.codigo}
                            </span>
                            <strong style={{ fontSize: '0.83rem' }}>{inc.descripcion}</strong>
                            {esObs3 && inc.datos?.sistema && (
                              <BadgeSistemaSalto sistema={inc.datos.sistema} />
                            )}
                            {inc.regla && (
                              <span className="font-mono text-muted" style={{ fontSize: '0.73rem' }}>
                                [{inc.regla}{REGLAS[inc.regla] ? `: ${REGLAS[inc.regla]}` : ''}]
                              </span>
                            )}
                          </div>
                          <div className="mt-1" style={{ fontSize: '0.82rem' }}>{inc.detalle}</div>
                          {esObs3 && obs3Faltantes.length > 0 && (
                            <div className="mt-2 d-flex align-items-center flex-wrap gap-1.5" style={{ gap: '6px' }}>
                              <span className="fw-semibold text-muted" style={{ fontSize: '0.76rem' }}>
                                Correlativo(s) faltante(s):
                              </span>
                              <ListaCorrelativosFaltantes
                                serie={inc.datos?.serie || doc.serie}
                                correlativos={obs3Faltantes}
                                total={obs3Total}
                                rangoTexto={obs3Rango}
                                truncado={obs3Truncado}
                                limiteInicial={12}
                              />
                            </div>
                          )}
                          {esFaltante && onSelectDoc && (doc.saltoMeta?.prevDoc || doc.saltoMeta?.nextDoc) && (
                            <div className="mt-2 pt-2 border-top d-flex align-items-center flex-wrap gap-2" style={{ borderColor: 'rgba(217,119,6,0.2)', fontSize: '0.76rem' }}>
                              <span className="text-muted fw-semibold">Documentos adyacentes de referencia:</span>
                              {doc.saltoMeta?.prevDoc && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-secondary py-0 px-2 font-mono"
                                  style={{ fontSize: '0.73rem' }}
                                  onClick={() => onSelectDoc(doc.saltoMeta.prevDoc)}
                                >
                                  Anterior: {doc.serie}-{doc.saltoMeta.anterior}
                                </button>
                              )}
                              {doc.saltoMeta?.nextDoc && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-secondary py-0 px-2 font-mono"
                                  style={{ fontSize: '0.73rem' }}
                                  onClick={() => onSelectDoc(doc.saltoMeta.nextDoc)}
                                >
                                  Posterior: {doc.serie}-{doc.saltoMeta.siguiente}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        {onFiltrarCodigo && (esErr || esObs) && (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary py-0 px-2 flex-shrink-0"
                            style={{ fontSize: '0.74rem' }}
                            onClick={() => {
                              onFiltrarCodigo(inc.codigo);
                              onClose();
                            }}
                          >
                            Ver todos ({inc.codigo})
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
});

export default ModalDetalleDocumentoVentas;
