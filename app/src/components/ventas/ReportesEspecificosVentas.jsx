// ============================================================================
// Sección 11: los 12 reportes específicos independientes del módulo de Ventas.
// Cada reporte muestra las columnas pertinentes a su validación, permite
// filtrar por resultado (Correctos / Incorrectos) y exportar a Excel.
// ============================================================================
import React, { useState, useMemo, memo } from 'react';
import { FiDownload, FiEye, FiCheckCircle, FiAlertTriangle, FiXCircle } from 'react-icons/fi';
import {
  REPORTES_ESPECIFICOS, calcularIndicadores, calcularSecuencias,
  evaluarDocParaReporteIdentidad, exportarExcelVentas,
} from '../../utils/ventas/reportes';
import { INCIDENCIAS, ESTADOS, descripcionTipoCP, descripcionTipoIdentidad } from '../../utils/ventas/catalogos';
import { formatoMonto, dentroDeTolerancia } from '../../utils/ventas/montos';
import { validarImportes } from '../../utils/ventas/reglas';

const ReportesEspecificosVentas = memo(function ReportesEspecificosVentas({
  docs, todosDocs, activePeriod, onSelectDoc, onFiltrarCodigo, reporteInicial = 'resumen',
}) {
  const [reporteId, setReporteId] = useState(reporteInicial);
  const [subEstado, setSubEstado] = useState('ALL'); // ALL | CORRECTO | INCORRECTO
  const [subTipoRuc, setSubTipoRuc] = useState('ALL'); // ALL | BOLETA | FACTURA (para reporte RUC)
  const [conceptoImp, setConceptoImp] = useState('ALL'); // ALL | ERROR 1..5,7
  const [pagina, setPagina] = useState(1);
  const porPagina = 25;

  const ind = useMemo(() => calcularIndicadores(docs), [docs]);

  const cambiarReporte = (id) => {
    setReporteId(id);
    setSubEstado('ALL');
    setPagina(1);
  };

  // Construcción de filas según el reporte activo
  const contenido = useMemo(() => {
    if (reporteId === 'resumen') return { tipo: 'resumen' };

    if (reporteId === 'correctos') {
      return { tipo: 'documentos', lista: docs.filter((d) => d.estado === 'OK') };
    }
    if (reporteId === 'errores') {
      return { tipo: 'documentos', lista: docs.filter((d) => d.estado === 'ERROR') };
    }
    if (reporteId === 'observaciones') {
      return { tipo: 'documentos', lista: docs.filter((d) => d.estado === 'OBSERVADO') };
    }

    if (reporteId === 'dni') {
      const evs = docs.map((d) => evaluarDocParaReporteIdentidad(d, '1')).filter(Boolean);
      const b700 = docs.filter((d) => d.tipo_doc_pago === '03' && ((d.sap?.total || 0) > 70000 || (d.sunat?.total || 0) > 70000));
      const filtrados = subEstado === 'ALL' ? evs : evs.filter((e) => e.resultado === subEstado);
      return { tipo: 'identidad', lista: filtrados, total: evs.length, correctos: evs.filter((e) => e.resultado === 'CORRECTO').length, b700 };
    }

    if (reporteId === 'ruc') {
      const bol = docs.map((d) => evaluarDocParaReporteIdentidad(d, '6')).filter(Boolean);
      const fac = docs.map((d) => evaluarDocParaReporteIdentidad(d, 'FACTURA')).filter(Boolean);
      const base = subTipoRuc === 'BOLETA' ? bol : subTipoRuc === 'FACTURA' ? fac : [...bol, ...fac];
      const filtrados = subEstado === 'ALL' ? base : base.filter((e) => e.resultado === subEstado);
      return {
        tipo: 'identidad',
        lista: filtrados,
        total: base.length,
        correctos: base.filter((e) => e.resultado === 'CORRECTO').length,
        conteoBoletas: bol.length,
        conteoFacturas: fac.length,
      };
    }

    if (reporteId === 'ce') {
      const evs = docs.map((d) => evaluarDocParaReporteIdentidad(d, '4')).filter(Boolean);
      const filtrados = subEstado === 'ALL' ? evs : evs.filter((e) => e.resultado === subEstado);
      return { tipo: 'identidad', lista: filtrados, total: evs.length, correctos: evs.filter((e) => e.resultado === 'CORRECTO').length };
    }

    if (reporteId === 'otros_id') {
      const evs = docs.map((d) => evaluarDocParaReporteIdentidad(d, '0')).filter(Boolean);
      const filtrados = subEstado === 'ALL' ? evs : evs.filter((e) => e.resultado === subEstado);
      return { tipo: 'identidad', lista: filtrados, total: evs.length, correctos: evs.filter((e) => e.resultado === 'CORRECTO').length };
    }

    if (reporteId === 'importes') {
      const filas = [];
      let docsCorrectos = 0;
      let docsConError = 0;
      for (const d of docs.filter((x) => x.en_sap && x.en_sunat)) {
        const { comparacion } = validarImportes(d);
        const tieneErr = comparacion.some((c) => !c.ok);
        if (tieneErr) docsConError += 1;
        else docsCorrectos += 1;
        for (const c of comparacion) {
          if (subEstado === 'INCORRECTO' && c.ok) continue;
          if (subEstado === 'CORRECTO' && !c.ok) continue;
          if (subEstado === 'ALL' && c.ok) continue; // por defecto muestra las diferencias encontradas
          if (conceptoImp !== 'ALL' && c.codigo !== conceptoImp) continue;
          filas.push({ doc: d, ...c });
        }
      }
      return { tipo: 'importes', lista: filas, docsCorrectos, docsConError };
    }

    if (reporteId === 'sin_coincidencia') {
      const lista = docs.filter((d) => !d.en_sap || !d.en_sunat);
      return {
        tipo: 'sin_coincidencia',
        lista,
        soloSunat: lista.filter((d) => !d.en_sap).length,
        soloSap: lista.filter((d) => !d.en_sunat).length,
      };
    }

    if (reporteId === 'secuencia') {
      const { series, saltos } = calcularSecuencias(todosDocs || docs);
      return { tipo: 'secuencia', series, lista: saltos };
    }

    if (reporteId === 'cortesias') {
      const todas = docs.filter((d) => d.cortesia);
      const filtradas = subEstado === 'ALL'
        ? todas
        : todas.filter((d) => (subEstado === 'CORRECTO' ? d.cortesia.resultado === 'CORRECTA' : d.cortesia.resultado !== 'CORRECTA'));
      return {
        tipo: 'cortesias',
        lista: filtradas,
        total: todas.length,
        correctas: todas.filter((d) => d.cortesia.resultado === 'CORRECTA').length,
      };
    }

    return { tipo: 'resumen' };
  }, [reporteId, docs, todosDocs, subEstado, subTipoRuc, conceptoImp]);

  const listaPaginada = useMemo(() => {
    const l = contenido.lista || [];
    return l.slice((pagina - 1) * porPagina, pagina * porPagina);
  }, [contenido.lista, pagina]);

  const totalPaginas = Math.ceil((contenido.lista?.length || 0) / porPagina);

  return (
    <div>
      {/* Selector de los 12 reportes */}
      <div className="d-flex flex-wrap gap-1.5 mb-3 pb-2 border-bottom" style={{ borderColor: 'var(--border-color)', gap: '6px' }}>
        {REPORTES_ESPECIFICOS.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`btn btn-sm rounded-3 fw-semibold ${reporteId === r.id ? 'btn-primary' : 'btn-outline-secondary'}`}
            style={{ fontSize: '0.78rem', padding: '0.35rem 0.7rem' }}
            onClick={() => cambiarReporte(r.id)}
          >
            {r.corto}
          </button>
        ))}
      </div>

      {/* Cabecera del reporte activo + botón exportar */}
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
        <div>
          <h5 className="mb-0 fw-bold">
            {REPORTES_ESPECIFICOS.find((r) => r.id === reporteId)?.titulo}
          </h5>
          {contenido.lista && (
            <small className="text-muted">
              {contenido.lista.length.toLocaleString('es-PE')} registro(s) en este reporte
            </small>
          )}
        </div>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          {['dni', 'ruc', 'ce', 'otros_id', 'cortesias'].includes(reporteId) && (
            <div className="btn-group btn-group-sm">
              <button type="button" className={`btn ${subEstado === 'ALL' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => { setSubEstado('ALL'); setPagina(1); }}>
                Todos ({contenido.total || 0})
              </button>
              <button type="button" className={`btn ${subEstado === 'CORRECTO' ? 'btn-success' : 'btn-outline-secondary'}`} onClick={() => { setSubEstado('CORRECTO'); setPagina(1); }}>
                Correctos ({contenido.correctos ?? contenido.correctas ?? 0})
              </button>
              <button type="button" className={`btn ${subEstado === 'INCORRECTO' ? 'btn-danger' : 'btn-outline-secondary'}`} onClick={() => { setSubEstado('INCORRECTO'); setPagina(1); }}>
                Incorrectos ({(contenido.total || 0) - (contenido.correctos ?? contenido.correctas ?? 0)})
              </button>
            </div>
          )}
          {reporteId === 'ruc' && (
            <select
              className="form-select form-select-sm form-control-premium"
              style={{ width: 'auto' }}
              value={subTipoRuc}
              onChange={(e) => { setSubTipoRuc(e.target.value); setPagina(1); }}
            >
              <option value="ALL">Boletas Cód. 6 + Facturas</option>
              <option value="BOLETA">Solo Boletas con RUC (5.3 · inicia con 10) [{contenido.conteoBoletas}]</option>
              <option value="FACTURA">Solo Facturas (5.5 · RUC 10 o 20) [{contenido.conteoFacturas}]</option>
            </select>
          )}
          {reporteId === 'importes' && (
            <>
              <select
                className="form-select form-select-sm form-control-premium"
                style={{ width: 'auto' }}
                value={conceptoImp}
                onChange={(e) => { setConceptoImp(e.target.value); setPagina(1); }}
              >
                <option value="ALL">Todos los conceptos con diferencia</option>
                <option value="ERROR 1">ERROR 1 · BI Gravada</option>
                <option value="ERROR 2">ERROR 2 · IGV / IPM</option>
                <option value="ERROR 3">ERROR 3 · Monto Exonerado</option>
                <option value="ERROR 4">ERROR 4 · Monto Inafecto</option>
                <option value="ERROR 5">ERROR 5 · Importe Total</option>
                <option value="ERROR 7">ERROR 7 · Otros Tributos</option>
              </select>
              <select
                className="form-select form-select-sm form-control-premium"
                style={{ width: 'auto' }}
                value={subEstado}
                onChange={(e) => { setSubEstado(e.target.value); setPagina(1); }}
              >
                <option value="ALL">Solo conceptos con diferencia (&gt; S/ 0.05)</option>
                <option value="CORRECTO">Conceptos correctos (≤ S/ 0.05)</option>
              </select>
            </>
          )}
          <button
            type="button"
            className="btn btn-sm btn-outline-primary d-flex align-items-center"
            onClick={() => exportarExcelVentas({ tipo: reporteId, docs, todosDocs, periodo: activePeriod })}
          >
            <FiDownload className="me-1" /> Exportar este reporte
          </button>
        </div>
      </div>

      {/* 1. RESUMEN GENERAL */}
      {contenido.tipo === 'resumen' && (
        <div className="row g-3">
          <div className="col-lg-7">
            <div className="p-3 rounded-3" style={{ backgroundColor: '#F8FAFC', border: '1px solid var(--border-color)' }}>
              <h6 className="fw-bold mb-2">Comparativa Monetaria Total por Concepto (SAP vs. SUNAT)</h6>
              <table className="table table-sm table-dense mb-0">
                <thead>
                  <tr>
                    <th>Concepto</th>
                    <th className="text-end">Total SAP (S/)</th>
                    <th className="text-end">Total SUNAT (S/)</th>
                    <th className="text-end">Diferencia (S/)</th>
                    <th className="text-center">Docs con Error</th>
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
                  ].map(([nombre, s, u, cod]) => {
                    const dif = s - u;
                    const nErr = ind.porCodigo[cod] || 0;
                    return (
                      <tr key={cod}>
                        <td className="fw-semibold">{nombre}</td>
                        <td className="text-end font-mono">{formatoMonto(s)}</td>
                        <td className="text-end font-mono">{formatoMonto(u)}</td>
                        <td className={`text-end font-mono ${!dentroDeTolerancia(dif) ? 'text-danger fw-bold' : 'text-success'}`}>
                          {formatoMonto(dif)}
                        </td>
                        <td className="text-center">
                          {nErr > 0 ? (
                            <button
                              type="button"
                              className="badge badge-status badge-status-error border-0"
                              style={{ cursor: 'pointer' }}
                              onClick={() => onFiltrarCodigo && onFiltrarCodigo(cod)}
                            >
                              {nErr} ({cod})
                            </button>
                          ) : (
                            <span className="badge badge-status badge-status-ok">0</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="col-lg-5">
            <div className="p-3 rounded-3 h-100" style={{ backgroundColor: '#F8FAFC', border: '1px solid var(--border-color)' }}>
              <h6 className="fw-bold mb-2">Resumen por Grupo de Error y Observación</h6>
              <table className="table table-sm table-dense mb-0">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Descripción</th>
                    <th className="text-end">Documentos</th>
                  </tr>
                </thead>
                <tbody>
                  {INCIDENCIAS.map((inc) => {
                    const n = ind.porCodigo[inc.codigo] || 0;
                    return (
                      <tr
                        key={inc.codigo}
                        style={{ cursor: n > 0 ? 'pointer' : 'default' }}
                        onClick={() => n > 0 && onFiltrarCodigo && onFiltrarCodigo(inc.codigo)}
                      >
                        <td>
                          <span className={`badge badge-status badge-status-${inc.tipo === 'ERROR' ? 'error' : 'observado'}`}>
                            {inc.codigo}
                          </span>
                        </td>
                        <td>{inc.corto}</td>
                        <td className="text-end font-mono fw-bold">{n.toLocaleString('es-PE')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 5.1 Sub-tabla Boletas > S/ 700 en el reporte de DNI */}
      {reporteId === 'dni' && contenido.b700 && (
        <div className="mb-3 p-3 rounded-3" style={{ backgroundColor: '#F8FAFC', border: '1px solid var(--border-color)' }}>
          <div className="fw-bold mb-2" style={{ fontSize: '0.85rem' }}>
            5.1. Boletas mayores a S/ 700.00 ({contenido.b700.length} comprobante(s) — deben registrar DNI Código 1)
          </div>
          <div className="table-responsive">
            <table className="table table-sm table-dense mb-0">
              <thead>
                <tr>
                  <th>Comprobante</th>
                  <th>Fecha</th>
                  <th>Tipo ID SAP</th>
                  <th>N° ID SAP</th>
                  <th>Nombre SAP</th>
                  <th className="text-end">Total SAP</th>
                  <th>Tipo ID SUNAT</th>
                  <th>N° ID SUNAT</th>
                  <th>Nombre SUNAT</th>
                  <th className="text-end">Total SUNAT</th>
                  <th className="text-center">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {contenido.b700.map((d) => {
                  const err = d.codigos.includes('ERROR 6');
                  return (
                    <tr key={d.key} style={{ cursor: 'pointer' }} onClick={() => onSelectDoc(d)}>
                      <td className="font-mono fw-semibold">{d.serie}-{d.correlativo}</td>
                      <td className="font-mono">{d.fecha_emision || '—'}</td>
                      <td className="font-mono">{d.en_sap ? descripcionTipoIdentidad(d.sap.tipo_identidad) : 'NO EXISTE'}</td>
                      <td className="font-mono">{d.sap?.nro_identidad || '—'}</td>
                      <td>{d.sap?.nombre || '—'}</td>
                      <td className="text-end font-mono">{d.en_sap ? formatoMonto(d.sap.total) : '—'}</td>
                      <td className="font-mono">{d.en_sunat ? descripcionTipoIdentidad(d.sunat.tipo_identidad) : 'NO EXISTE'}</td>
                      <td className="font-mono">{d.sunat?.nro_identidad || '—'}</td>
                      <td>{d.sunat?.nombre || '—'}</td>
                      <td className="text-end font-mono">{d.en_sunat ? formatoMonto(d.sunat.total) : '—'}</td>
                      <td className="text-center">
                        <span className={`badge badge-status badge-status-${err ? 'error' : 'ok'}`}>
                          {err ? 'ERROR 6: SIN DNI' : 'CORRECTO'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5.2 - 5.6 REPORTES DE IDENTIDAD (DNI, RUC, CE, OTROS) */}
      {contenido.tipo === 'identidad' && (
        <div className="table-responsive">
          <table className="table table-hover table-dense align-middle mb-0">
            <thead>
              <tr>
                <th>N° Comprobante</th>
                <th>Fecha</th>
                <th>Tipo ID SAP</th>
                <th>N° Identidad SAP</th>
                <th>Nombre en SAP</th>
                <th>Tipo ID SUNAT</th>
                <th>N° Identidad SUNAT</th>
                <th>Nombre en SUNAT</th>
                <th className="text-center">Resultado</th>
                <th className="text-center">Sistema Correcto</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {listaPaginada.map((ev) => {
                const d = ev.doc;
                const ok = ev.resultado === 'CORRECTO';
                return (
                  <tr key={d.key} style={{ cursor: 'pointer' }} onClick={() => onSelectDoc(d)}>
                    <td className="font-mono fw-semibold">{d.serie}-{d.correlativo}</td>
                    <td className="font-mono">{d.fecha_emision || '—'}</td>
                    <td className={`font-mono ${!ev.sap_ok ? 'cell-mismatch' : ''}`}>
                      {d.en_sap ? descripcionTipoIdentidad(d.sap.tipo_identidad) : 'NO EXISTE'}
                    </td>
                    <td className={`font-mono ${!ev.sap_ok ? 'cell-mismatch' : ''}`}>
                      {d.en_sap ? (d.sap.nro_identidad || '—') : '—'}
                    </td>
                    <td className="text-truncate" style={{ maxWidth: '170px' }} title={d.sap?.nombre}>
                      {d.en_sap ? (d.sap.nombre || '—') : '—'}
                    </td>
                    <td className={`font-mono ${!ev.sunat_ok ? 'cell-mismatch' : ''}`}>
                      {d.en_sunat ? descripcionTipoIdentidad(d.sunat.tipo_identidad) : 'NO EXISTE'}
                    </td>
                    <td className={`font-mono ${!ev.sunat_ok ? 'cell-mismatch' : ''}`}>
                      {d.en_sunat ? (d.sunat.nro_identidad || '—') : '—'}
                    </td>
                    <td className="text-truncate" style={{ maxWidth: '170px' }} title={d.sunat?.nombre}>
                      {d.en_sunat ? (d.sunat.nombre || '—') : '—'}
                    </td>
                    <td className="text-center">
                      <span className={`badge badge-status badge-status-${ok ? 'ok' : 'observado'}`}>
                        {ev.resultado}
                      </span>
                    </td>
                    <td className="text-center">
                      <span className="badge font-mono" style={{
                        backgroundColor: ev.sistema_correcto === 'AMBOS' ? 'rgba(5,150,105,0.12)' : ev.sistema_correcto === 'NINGUNO' ? 'rgba(220,38,38,0.12)' : 'rgba(37,99,235,0.12)',
                        color: ev.sistema_correcto === 'AMBOS' ? '#047857' : ev.sistema_correcto === 'NINGUNO' ? '#B91C1C' : '#1D4ED8',
                      }}>
                        {ev.sistema_correcto}
                      </span>
                    </td>
                    <td className="text-truncate" style={{ maxWidth: '240px' }} title={ev.motivo}>{ev.motivo}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 6. REPORTE DE DIFERENCIAS DE IMPORTES */}
      {contenido.tipo === 'importes' && (
        <div>
          <div className="mb-2 d-flex gap-3" style={{ fontSize: '0.82rem' }}>
            <span className="text-success fw-semibold">
              <FiCheckCircle className="me-1" /> Comprobantes con importes correctos (≤ S/ 0.05): {contenido.docsCorrectos.toLocaleString('es-PE')}
            </span>
            <span className="text-danger fw-semibold">
              <FiXCircle className="me-1" /> Comprobantes con diferencias de importes (&gt; S/ 0.05): {contenido.docsConError.toLocaleString('es-PE')}
            </span>
          </div>
          <div className="table-responsive">
            <table className="table table-hover table-dense align-middle mb-0">
              <thead>
                <tr>
                  <th>N° Comprobante</th>
                  <th>Fecha</th>
                  <th>Tipo CP</th>
                  <th>Código</th>
                  <th>Concepto con Diferencia</th>
                  <th className="text-end">Importe SAP</th>
                  <th className="text-end">Importe SUNAT</th>
                  <th className="text-end">Diferencia</th>
                  <th className="text-center">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {listaPaginada.map((f, i) => (
                  <tr key={`${f.doc.key}-${f.campo}-${i}`} style={{ cursor: 'pointer' }} onClick={() => onSelectDoc(f.doc)}>
                    <td className="font-mono fw-semibold">{f.doc.serie}-{f.doc.correlativo}</td>
                    <td className="font-mono">{f.doc.fecha_emision || '—'}</td>
                    <td>{descripcionTipoCP(f.doc.tipo_doc_pago)}</td>
                    <td><span className={`badge badge-status badge-status-${f.ok ? 'ok' : 'error'}`}>{f.codigo}</span></td>
                    <td className="fw-semibold">{f.concepto}</td>
                    <td className="text-end font-mono">{formatoMonto(f.sap)}</td>
                    <td className="text-end font-mono">{formatoMonto(f.sunat)}</td>
                    <td className={`text-end font-mono ${f.ok ? 'text-success' : 'cell-mismatch'}`}>{formatoMonto(f.diferencia)}</td>
                    <td className="text-center">
                      <span className={`badge badge-status badge-status-${f.ok ? 'ok' : 'error'}`}>
                        {f.ok ? 'CORRECTO' : 'ERROR'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 11. PROBLEMAS DE SECUENCIA */}
      {contenido.tipo === 'secuencia' && (
        <div className="row g-3">
          <div className="col-lg-5">
            <div className="p-3 rounded-3" style={{ backgroundColor: '#F8FAFC', border: '1px solid var(--border-color)' }}>
              <h6 className="fw-bold mb-2">Continuidad por Serie</h6>
              <table className="table table-sm table-dense mb-0">
                <thead>
                  <tr>
                    <th>Serie</th>
                    <th>Tipo</th>
                    <th className="text-end">Docs</th>
                    <th className="text-end">Rango</th>
                    <th className="text-end">Saltos</th>
                    <th className="text-center">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {contenido.series.map((s) => (
                    <tr key={`${s.tipo_doc_pago}-${s.serie}`}>
                      <td className="font-mono fw-bold">{s.serie}</td>
                      <td>{descripcionTipoCP(s.tipo_doc_pago)}</td>
                      <td className="text-end font-mono">{s.documentos}</td>
                      <td className="text-end font-mono">{s.primero} → {s.ultimo}</td>
                      <td className="text-end font-mono">{s.saltos} ({s.faltantes} falt.)</td>
                      <td className="text-center">
                        <span className={`badge badge-status badge-status-${s.saltos === 0 ? 'ok' : 'observado'}`}>
                          {s.estado}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="col-lg-7">
            <div className="p-3 rounded-3" style={{ backgroundColor: '#F8FAFC', border: '1px solid var(--border-color)' }}>
              <h6 className="fw-bold mb-2">Detalle de Saltos de Numeración ({contenido.lista.length})</h6>
              <div className="table-responsive">
                <table className="table table-sm table-hover table-dense mb-0">
                  <thead>
                    <tr>
                      <th>Serie Afectada</th>
                      <th>Correlativo Anterior</th>
                      <th>Fecha Ant.</th>
                      <th>Correlativo Siguiente</th>
                      <th>Fecha Sig.</th>
                      <th className="text-end">Diferencia</th>
                      <th className="text-end">Faltantes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listaPaginada.map((s, i) => (
                      <tr key={i} style={{ cursor: 'pointer' }} onClick={() => onSelectDoc(s.doc)}>
                        <td className="font-mono fw-bold">{s.serie}</td>
                        <td className="font-mono">{s.anterior}</td>
                        <td className="font-mono">{s.fecha_anterior || '—'}</td>
                        <td className="font-mono fw-semibold text-warning">{s.siguiente}</td>
                        <td className="font-mono">{s.fecha_siguiente || '—'}</td>
                        <td className="text-end font-mono fw-bold">{s.diferencia}</td>
                        <td className="text-end font-mono text-danger fw-bold">{s.faltantes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 12. VALIDACIÓN DE CORTESÍAS */}
      {contenido.tipo === 'cortesias' && (
        <div className="table-responsive">
          <table className="table table-hover table-dense align-middle mb-0">
            <thead>
              <tr>
                <th>Comprobante</th>
                <th>Fecha</th>
                <th className="text-end">BI SAP</th>
                <th className="text-end">IGV SAP</th>
                <th className="text-end">Otros SAP</th>
                <th className="text-end">Total SAP</th>
                <th className="text-end">BI SUNAT</th>
                <th className="text-end">IGV SUNAT</th>
                <th className="text-end">Otros SUNAT</th>
                <th className="text-end">Total SUNAT</th>
                <th className="text-center">Excel Cortesías</th>
                <th className="text-center">Resultado</th>
                <th>Detalle / Motivo</th>
              </tr>
            </thead>
            <tbody>
              {listaPaginada.map((d) => {
                const c = d.cortesia;
                const ok = c.resultado === 'CORRECTA';
                return (
                  <tr key={d.key} style={{ cursor: 'pointer' }} onClick={() => onSelectDoc(d)}>
                    <td className="font-mono fw-semibold">{d.serie}-{d.correlativo}</td>
                    <td className="font-mono">{d.fecha_emision || '—'}</td>
                    <td className="text-end font-mono">{d.en_sap ? formatoMonto(d.sap.base) : '—'}</td>
                    <td className="text-end font-mono">{d.en_sap ? formatoMonto(d.sap.igv) : '—'}</td>
                    <td className="text-end font-mono">{d.en_sap ? formatoMonto(d.sap.otros) : '—'}</td>
                    <td className="text-end font-mono">{d.en_sap ? formatoMonto(d.sap.total) : '—'}</td>
                    <td className="text-end font-mono">{d.en_sunat ? formatoMonto(d.sunat.base) : '—'}</td>
                    <td className="text-end font-mono">{d.en_sunat ? formatoMonto(d.sunat.igv) : '—'}</td>
                    <td className="text-end font-mono">{d.en_sunat ? formatoMonto(d.sunat.otros) : '—'}</td>
                    <td className="text-end font-mono">{d.en_sunat ? formatoMonto(d.sunat.total) : '—'}</td>
                    <td className="text-center">
                      {c.en_excel === null ? <span className="text-muted">No cargado</span> :
                        c.en_excel ? <span className="badge badge-status badge-status-ok">En Excel</span> :
                          <span className="badge badge-status badge-status-observado">No figura</span>}
                    </td>
                    <td className="text-center">
                      <span className={`badge badge-status badge-status-${ok ? 'ok' : 'error'}`}>{c.resultado}</span>
                    </td>
                    <td className="text-truncate" style={{ maxWidth: '240px' }} title={c.motivos?.join(' · ') || c.excel?.observacion}>
                      {c.motivos?.length ? c.motivos.join(' · ') : (c.excel?.detalle || 'Importes de cortesía coinciden en SAP y SUNAT')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 2, 3, 4 y 10. TABLA DE DOCUMENTOS (Correctos, Errores, Observaciones, Sin coincidencia) */}
      {(contenido.tipo === 'documentos' || contenido.tipo === 'sin_coincidencia') && (
        <div>
          {contenido.tipo === 'sin_coincidencia' && (
            <div className="mb-2 d-flex gap-3" style={{ fontSize: '0.82rem' }}>
              <span className="text-warning fw-semibold">
                <FiAlertTriangle className="me-1" /> OBS 4 · Únicamente en SUNAT (No existe en SAP): {contenido.soloSunat}
              </span>
              <span className="text-warning fw-semibold">
                <FiAlertTriangle className="me-1" /> OBS 5 · Únicamente en SAP (No existe en SUNAT): {contenido.soloSap}
              </span>
            </div>
          )}
          <div className="table-responsive">
            <table className="table table-hover table-dense align-middle mb-0">
              <thead>
                <tr>
                  <th>N° Documento</th>
                  <th>Fecha</th>
                  <th>Tipo CP</th>
                  <th>ID SAP</th>
                  <th>Nombre SAP</th>
                  <th>ID SUNAT</th>
                  <th>Nombre SUNAT</th>
                  <th className="text-end">Total SAP</th>
                  <th className="text-end">Total SUNAT</th>
                  <th className="text-center">Estado</th>
                  <th>Incidencias</th>
                  <th className="text-center">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {listaPaginada.map((d) => {
                  const est = ESTADOS[d.estado] || ESTADOS.OK;
                  return (
                    <tr key={d.key} style={{ cursor: 'pointer' }} onClick={() => onSelectDoc(d)}>
                      <td className="font-mono fw-semibold">{d.serie}-{d.correlativo}</td>
                      <td className="font-mono">{d.fecha_emision || '—'}</td>
                      <td>{descripcionTipoCP(d.tipo_doc_pago)}</td>
                      <td className="font-mono">{d.en_sap ? `${d.sap.tipo_identidad}:${d.sap.nro_identidad}` : <span className="text-danger">NO EXISTE</span>}</td>
                      <td className="text-truncate" style={{ maxWidth: '150px' }}>{d.sap?.nombre || '—'}</td>
                      <td className="font-mono">{d.en_sunat ? `${d.sunat.tipo_identidad}:${d.sunat.nro_identidad}` : <span className="text-danger">NO EXISTE</span>}</td>
                      <td className="text-truncate" style={{ maxWidth: '150px' }}>{d.sunat?.nombre || '—'}</td>
                      <td className="text-end font-mono">{d.en_sap ? formatoMonto(d.sap.total) : '—'}</td>
                      <td className="text-end font-mono">{d.en_sunat ? formatoMonto(d.sunat.total) : '—'}</td>
                      <td className="text-center">
                        <span className={`badge badge-status badge-status-${est.clase}`}>{est.etiqueta}</span>
                      </td>
                      <td>
                        <div className="d-flex flex-wrap gap-1">
                          {d.codigos.length ? d.codigos.map((c) => (
                            <span key={c} className={`badge badge-status badge-status-${c.startsWith('ERROR') ? 'error' : 'observado'}`}>
                              {c}
                            </span>
                          )) : <span className="text-success" style={{ fontSize: '0.75rem' }}>Sin incidencias</span>}
                        </div>
                      </td>
                      <td className="text-center">
                        <button type="button" className="btn btn-sm btn-outline-secondary p-1 border-0" onClick={(e) => { e.stopPropagation(); onSelectDoc(d); }}>
                          <FiEye />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Paginación del reporte */}
      {totalPaginas > 1 && (
        <div className="d-flex justify-content-between align-items-center mt-3 pt-2 border-top" style={{ borderColor: 'var(--border-color)' }}>
          <small className="text-muted">
            Página {pagina} de {totalPaginas} ({contenido.lista.length.toLocaleString('es-PE')} registros)
          </small>
          <div className="d-flex gap-1">
            <button type="button" className="btn btn-sm btn-outline-secondary" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>
              Anterior
            </button>
            <button type="button" className="btn btn-sm btn-outline-secondary" disabled={pagina >= totalPaginas} onClick={() => setPagina(pagina + 1)}>
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

export default ReportesEspecificosVentas;
