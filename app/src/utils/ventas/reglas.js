// ============================================================================
// Reglas de validación del módulo de Ventas (Hoja "flujo").
// Cada regla es una función pura e independiente que devuelve incidencias
// trazables: { codigo, tipo, descripcion, detalle, regla, datos }.
// ============================================================================
import { INCIDENCIA_POR_CODIGO, LIMITE_BOLETA_CENTIMOS, TIPO } from './catalogos.js';
import { dentroDeTolerancia, formatoMonto } from './montos.js';
import {
  compararCorrelativos,
  correlativoCanonico,
  parsearCorrelativoBigInt,
  generarCorrelativosFaltantes,
} from './documento.js';

export function crearIncidencia(codigo, regla, detalle, datos = {}) {
  const def = INCIDENCIA_POR_CODIGO[codigo];
  return { codigo, tipo: def.tipo, descripcion: def.descripcion, detalle, regla, datos };
}

const normTexto = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

/** Número repetido o genérico: vacío o compuesto por un mismo carácter (00000000, 11111111). */
export const esNumeroRepetido = (nro) => {
  const s = String(nro ?? '').trim();
  return s === '' || /^(.)\1*$/.test(s);
};

/** Nombre genérico: contiene la palabra CLIENTE (hoja flujo: distinto a *cliente*). */
export const esNombreCliente = (nombre) => normTexto(nombre).includes('CLIENTE');

/**
 * "Nombre completo" (regla tipo 0): al menos dos palabras alfabéticas y que no
 * sea el genérico "CLIENTE ...". Criterio operativo - ver puntos a confirmar.
 */
export const esNombreCompleto = (nombre) => {
  const n = normTexto(nombre);
  if (!n || esNombreCliente(n)) return false;
  return n.split(' ').filter((p) => /^[A-ZÑ]{2,}$/.test(p)).length >= 2;
};

// ---------------------------------------------------------------------------
// 5. Validación del tipo y número de identidad (por sistema)
// ---------------------------------------------------------------------------
/**
 * Evalúa las reglas de identidad aplicables a los datos de UN sistema.
 * @param {{tipo_identidad, nro_identidad, nombre, total}} reg  registro SAP o SUNAT
 * @param {string} tipoCP  '01' factura | '03' boleta
 * @returns {Array<{regla, nombre, ok, motivo}>}
 */
export function evaluarIdentidad(reg, tipoCP) {
  const ev = [];
  const tipo = String(reg.tipo_identidad ?? '').trim();
  const nro = String(reg.nro_identidad ?? '').trim();
  const nombre = reg.nombre;
  const esBoleta = tipoCP === '03';
  const esFactura = tipoCP === '01';

  // 5.1 Boletas mayores a S/ 700 -> DNI (tipo 1)
  if (esBoleta && reg.total > LIMITE_BOLETA_CENTIMOS) {
    const ok = tipo === '1';
    ev.push({ regla: 'R-ID-01', nombre: 'BOLETA > 700', ok, motivo: ok ? 'Tiene DNI' : `Total S/ ${formatoMonto(reg.total)} con tipo de identidad ${tipo || 'vacío'} (se exige 1 - DNI)` });
  }
  // 5.2 DNI - código 1
  if (tipo === '1') {
    const m = [];
    if (esNumeroRepetido(nro)) m.push(`número repetido/genérico (${nro || 'vacío'})`);
    if (esNombreCliente(nombre)) m.push(`nombre genérico "${nombre}"`);
    ev.push({ regla: 'R-ID-02', nombre: 'DNI', ok: m.length === 0, motivo: m.length ? m.join('; ') : 'DNI válido' });
  }
  // 5.3 RUC - código 6 en boletas
  if (esBoleta && tipo === '6') {
    const ok = nro.startsWith('10');
    ev.push({ regla: 'R-ID-03', nombre: 'RUC (boleta)', ok, motivo: ok ? 'RUC inicia con 10' : `RUC ${nro || 'vacío'} no inicia con 10` });
  }
  // 5.4 Carnet de extranjería - código 4 en boletas
  if (esBoleta && tipo === '4') {
    const m = [];
    if (esNumeroRepetido(nro)) m.push(`número repetido/genérico (${nro || 'vacío'})`);
    if (esNombreCliente(nombre)) m.push(`nombre genérico "${nombre}"`);
    ev.push({ regla: 'R-ID-04', nombre: 'Carnet de extranjería', ok: m.length === 0, motivo: m.length ? m.join('; ') : 'CE válido' });
  }
  // 5.5 Facturas: tipo 6 e inicia con 20 o 10
  if (esFactura) {
    const m = [];
    if (tipo !== '6') m.push(`tipo de identidad ${tipo || 'vacío'} (se exige 6 - RUC)`);
    if (!/^(20|10)/.test(nro)) m.push(`número ${nro || 'vacío'} no inicia con 20 ni 10`);
    ev.push({ regla: 'R-ID-05', nombre: 'Factura', ok: m.length === 0, motivo: m.length ? m.join('; ') : 'RUC válido para factura' });
  }
  // 5.6 Otros - código 0 en boletas
  if (esBoleta && tipo === '0') {
    const m = [];
    if (esNombreCompleto(nombre)) m.push(`registra nombre completo "${nombre}"`);
    if (!/^(\d)\1*$/.test(nro)) m.push(`número ${nro || 'vacío'} no está compuesto por dígitos iguales ni es 0`);
    ev.push({ regla: 'R-ID-06', nombre: 'Otros (tipo 0)', ok: m.length === 0, motivo: m.length ? m.join('; ') : 'Correcto' });
  }
  return ev;
}

/** Determina en qué sistema está el dato de identidad correcto. */
export function sistemaCorrecto(enSap, enSunat, sapCumple, sunatCumple) {
  if (enSap && enSunat) {
    if (sapCumple && sunatCumple) return 'AMBOS';
    if (sapCumple) return 'SAP';
    if (sunatCumple) return 'SUNAT';
    return 'NINGUNO';
  }
  if (enSap) return sapCumple ? 'SAP' : 'NINGUNO';
  if (enSunat) return sunatCumple ? 'SUNAT' : 'NINGUNO';
  return 'N/A';
}

/**
 * Aplica las reglas de identidad al documento conciliado.
 * Devuelve { incidencias, identidad } donde identidad guarda la trazabilidad completa.
 */
export function validarIdentidad(doc) {
  const incidencias = [];
  const { sap, sunat } = doc;
  const evSap = sap ? evaluarIdentidad(sap, doc.tipo_doc_pago) : null;
  const evSunat = sunat ? evaluarIdentidad(sunat, doc.tipo_doc_pago) : null;
  const sapCumple = evSap ? evSap.every((e) => e.ok) : null;
  const sunatCumple = evSunat ? evSunat.every((e) => e.ok) : null;

  // ERROR 6 - Boletas > 700 sin DNI (en el/los sistema(s) que incumplen)
  const f700 = [];
  if (evSap?.some((e) => e.regla === 'R-ID-01' && !e.ok)) f700.push('SAP');
  if (evSunat?.some((e) => e.regla === 'R-ID-01' && !e.ok)) f700.push('SUNAT');
  if (f700.length) {
    const tot = sunat ? sunat.total : sap.total;
    incidencias.push(crearIncidencia('ERROR 6', 'R-ID-01',
      `Boleta con total S/ ${formatoMonto(tot)} sin DNI en ${f700.join(' y ')}`,
      { sistemas: f700, total_sap: sap?.total ?? null, total_sunat: sunat?.total ?? null }));
  }

  // OBS 1 / OBS 2 - Diferencias SAP vs SUNAT
  if (sap && sunat) {
    const tSap = String(sap.tipo_identidad ?? '').trim();
    const tSun = String(sunat.tipo_identidad ?? '').trim();
    if (tSap !== tSun) {
      incidencias.push(crearIncidencia('OBS 1', 'R-ID-07', `Tipo de identidad SAP (${tSap || 'vacío'}) ≠ SUNAT (${tSun || 'vacío'})`, { sap: tSap, sunat: tSun }));
    }
    const nSap = String(sap.nro_identidad ?? '').trim();
    const nSun = String(sunat.nro_identidad ?? '').trim();
    if (nSap !== nSun) {
      incidencias.push(crearIncidencia('OBS 2', 'R-ID-08', `Número de identidad SAP (${nSap || 'vacío'}) ≠ SUNAT (${nSun || 'vacío'})`, { sap: nSap, sunat: nSun }));
    }
  }

  // OBS 6 - Incumplimiento de reglas de identidad (excluye R-ID-01, ya cubierta por ERROR 6)
  const fallas = [];
  evSap?.filter((e) => !e.ok && e.regla !== 'R-ID-01').forEach((e) => fallas.push({ sistema: 'SAP', ...e }));
  evSunat?.filter((e) => !e.ok && e.regla !== 'R-ID-01').forEach((e) => fallas.push({ sistema: 'SUNAT', ...e }));
  if (fallas.length) {
    incidencias.push(crearIncidencia('OBS 6', fallas.map((f) => f.regla).filter((v, i, a) => a.indexOf(v) === i).join(', '),
      fallas.map((f) => `${f.sistema} · ${f.nombre}: ${f.motivo}`).join(' | '), { fallas }));
  }

  return {
    incidencias,
    identidad: {
      sap: evSap, sunat: evSunat, sap_cumple: sapCumple, sunat_cumple: sunatCumple,
      sistema_correcto: sistemaCorrecto(!!sap, !!sunat, sapCumple, sunatCumple),
    },
  };
}

// ---------------------------------------------------------------------------
// 6. Validación de importes (tolerancia S/ 0.05)
// ---------------------------------------------------------------------------
export const CONCEPTOS_IMPORTE = [
  { campo: 'base', concepto: 'BI Gravada', codigo: 'ERROR 1', regla: 'R-IMP-01' },
  { campo: 'igv', concepto: 'IGV / IPM', codigo: 'ERROR 2', regla: 'R-IMP-02' },
  { campo: 'exonerado', concepto: 'Monto exonerado', codigo: 'ERROR 3', regla: 'R-IMP-03' },
  { campo: 'inafecto', concepto: 'Monto inafecto', codigo: 'ERROR 4', regla: 'R-IMP-04' },
  { campo: 'otros', concepto: 'Otros tributos', codigo: 'ERROR 7', regla: 'R-IMP-06' },
  { campo: 'total', concepto: 'Importe total', codigo: 'ERROR 5', regla: 'R-IMP-05' },
];

/** Compara por comprobante y por concepto. Solo aplica si el documento existe en ambos sistemas. */
export function validarImportes(doc) {
  if (!doc.sap || !doc.sunat) return { incidencias: [], comparacion: [] };
  const incidencias = [];
  const comparacion = CONCEPTOS_IMPORTE.map((c) => {
    const s = doc.sap[c.campo] || 0;
    const u = doc.sunat[c.campo] || 0;
    const dif = s - u;
    const ok = dentroDeTolerancia(dif);
    if (!ok) {
      incidencias.push(crearIncidencia(c.codigo, c.regla,
        `${c.concepto}: SAP ${formatoMonto(s)} | SUNAT ${formatoMonto(u)} | Diferencia ${formatoMonto(dif)}`,
        { concepto: c.concepto, campo: c.campo, sap: s, sunat: u, diferencia: dif }));
    }
    return { ...c, sap: s, sunat: u, diferencia: dif, ok };
  });
  return { incidencias, comparacion };
}

// ---------------------------------------------------------------------------
// 7. Cortesías
// ---------------------------------------------------------------------------
/** Cortesía según importes: BI, IGV u otros tributos con importe y total = 0. */
export const esCortesiaPorImportes = (r) =>
  !!r && r.total === 0 && (r.base !== 0 || r.igv !== 0 || r.otros !== 0);

/**
 * Valida que la cortesía esté registrada correctamente en SAP y SUNAT.
 * @param {object} doc documento conciliado
 * @param {object|null} excel registro del Excel de cortesías (si se cargó y existe)
 * @param {boolean} excelCargado si se cargó el Excel opcional
 * @returns {object|null} null si el documento no es candidato a cortesía
 */
export function validarCortesia(doc, excel, excelCargado) {
  const sapC = esCortesiaPorImportes(doc.sap);
  const sunC = esCortesiaPorImportes(doc.sunat);
  if (!sapC && !sunC && !excel) return null;
  const motivos = [];
  if (!doc.sap) motivos.push('No existe en SAP');
  else if (!sapC) motivos.push(`SAP no registra importes de cortesía (BI ${formatoMonto(doc.sap.base)}, IGV ${formatoMonto(doc.sap.igv)}, Total ${formatoMonto(doc.sap.total)})`);
  if (!doc.sunat) motivos.push('No existe en SUNAT');
  else if (!sunC) motivos.push(`SUNAT no registra importes de cortesía (BI ${formatoMonto(doc.sunat.base)}, IGV ${formatoMonto(doc.sunat.igv)}, Total ${formatoMonto(doc.sunat.total)})`);
  if (doc.sap && doc.sunat) {
    for (const c of CONCEPTOS_IMPORTE.filter((x) => ['base', 'igv', 'otros'].includes(x.campo))) {
      const dif = (doc.sap[c.campo] || 0) - (doc.sunat[c.campo] || 0);
      if (!dentroDeTolerancia(dif)) motivos.push(`${c.concepto} difiere SAP vs SUNAT (${formatoMonto(dif)})`);
    }
  }
  if (excelCargado && !excel) motivos.push('No figura en el Excel de cortesías');
  return {
    sap: sapC,
    sunat: sunC,
    en_excel: excelCargado ? !!excel : null,
    excel: excel ? { documento: excel.documento, detalle: excel.detalle, observacion: excel.observacion, tipo_pago: excel.tipo_pago, restaurante: excel.restaurante } : null,
    resultado: motivos.length ? 'INCORRECTA' : 'CORRECTA',
    motivos,
    regla: 'R-COR-01',
  };
}

// ---------------------------------------------------------------------------
// 4.4 Secuencia de correlativos (por tipo + serie, evaluando SAP y SUNAT)
// ---------------------------------------------------------------------------
export const ETIQUETA_SISTEMA_SALTO = {
  AMBOS: 'AMBOS (SAP y SUNAT)',
  SAP: 'Solo SAP',
  SUNAT: 'Solo SUNAT',
};

function detectarSaltosEnSistema(subLista) {
  if (!subLista || subLista.length < 2) return [];
  const ordenados = [...subLista].sort((a, b) => compararCorrelativos(a.correlativo, b.correlativo));
  const saltos = [];
  let prev = ordenados[0];
  let prevNum = parsearCorrelativoBigInt(prev.correlativo);

  for (let i = 1; i < ordenados.length; i++) {
    const curr = ordenados[i];
    const currNum = parsearCorrelativoBigInt(curr.correlativo);
    if (prevNum !== null && currNum !== null) {
      if (currNum === prevNum) continue; // mismo correlativo canónico
      if (currNum - prevNum > 1n) {
        saltos.push({
          start: prevNum + 1n,
          end: currNum - 1n,
          prev,
          curr,
          anterior: prev.correlativo,
          fecha_anterior: prev.fecha_emision,
          siguiente: curr.correlativo,
          fecha_siguiente: curr.fecha_emision,
        });
      }
    }
    prev = curr;
    prevNum = currNum;
  }
  return saltos;
}

function combinarSaltosPorSistema(sapGaps, sunatGaps) {
  if (sapGaps.length === 0 && sunatGaps.length === 0) return [];
  const ptsSet = new Set();
  for (const g of sapGaps) {
    ptsSet.add(g.start);
    ptsSet.add(g.end + 1n);
  }
  for (const g of sunatGaps) {
    ptsSet.add(g.start);
    ptsSet.add(g.end + 1n);
  }
  const pts = [...ptsSet].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const combinados = [];
  let iSap = 0;
  let iSun = 0;

  for (let k = 0; k < pts.length - 1; k++) {
    const segStart = pts[k];
    const segEnd = pts[k + 1] - 1n;
    if (segStart > segEnd) continue;

    while (iSap < sapGaps.length && sapGaps[iSap].end < segStart) iSap++;
    while (iSun < sunatGaps.length && sunatGaps[iSun].end < segStart) iSun++;

    const gSap =
      iSap < sapGaps.length && sapGaps[iSap].start <= segStart && sapGaps[iSap].end >= segEnd
        ? sapGaps[iSap]
        : null;
    const gSun =
      iSun < sunatGaps.length && sunatGaps[iSun].start <= segStart && sunatGaps[iSun].end >= segEnd
        ? sunatGaps[iSun]
        : null;

    if (!gSap && !gSun) continue;

    const sistema = gSap && gSun ? 'AMBOS' : gSap ? 'SAP' : 'SUNAT';
    const ref = gSun || gSap;
    const generados = generarCorrelativosFaltantes(segStart, segEnd, ref.anterior, ref.siguiente, 200);

    combinados.push({
      start: segStart,
      end: segEnd,
      sistema,
      sistema_etiqueta: ETIQUETA_SISTEMA_SALTO[sistema],
      doc: ref.curr,
      prevDoc: ref.prev,
      tipo_doc_pago: ref.curr.tipo_doc_pago,
      serie: ref.curr.serie,
      anterior: ref.anterior,
      fecha_anterior: ref.fecha_anterior,
      siguiente: ref.siguiente,
      fecha_siguiente: ref.fecha_siguiente,
      anterior_sap: gSap ? gSap.anterior : null,
      siguiente_sap: gSap ? gSap.siguiente : null,
      anterior_sunat: gSun ? gSun.anterior : null,
      siguiente_sunat: gSun ? gSun.siguiente : null,
      diferencia: generados.total + 1,
      faltantes: generados.total,
      correlativos_faltantes: generados.lista,
      faltantes_truncado: generados.truncado,
      primer_faltante: generados.primero,
      ultimo_faltante: generados.ultimo,
      rango_faltante: generados.rangoTexto,
    });
  }
  return combinados;
}

function construirIncidenciaObs3(salto) {
  const maxGuardar = 20;
  const listaCorta = salto.correlativos_faltantes.slice(0, maxGuardar);
  const resumenFaltantes =
    salto.faltantes <= 5
      ? listaCorta.join(', ')
      : `${salto.rango_faltante} (${salto.faltantes} correlativos)`;

  const detalle =
    `Serie ${salto.serie} · Salto en ${salto.sistema_etiqueta}: ` +
    `de ${salto.anterior} (${salto.fecha_anterior || 's/f'}) a ${salto.siguiente} (${salto.fecha_siguiente || 's/f'}) · ` +
    `falta(n) ${salto.faltantes} correlativo(s): ${resumenFaltantes}`;

  const datos = {
    serie: salto.serie,
    tipo_doc_pago: salto.tipo_doc_pago,
    sistema: salto.sistema,
    anterior: salto.anterior,
    fecha_anterior: salto.fecha_anterior,
    siguiente: salto.siguiente,
    fecha_siguiente: salto.fecha_siguiente,
    anterior_sap: salto.anterior_sap,
    siguiente_sap: salto.siguiente_sap,
    anterior_sunat: salto.anterior_sunat,
    siguiente_sunat: salto.siguiente_sunat,
    diferencia: salto.diferencia,
    faltantes: salto.faltantes,
    correlativos_faltantes: listaCorta,
    faltantes_truncado: salto.faltantes > maxGuardar,
    rango_faltante: salto.rango_faltante,
  };

  return crearIncidencia('OBS 3', 'R-SEC-01', detalle, datos);
}

/**
 * Analiza la continuidad de correlativos por tipo + serie evaluando SAP y SUNAT
 * por separado y combinando los saltos para identificar si falta en SAP, SUNAT o AMBOS,
 * junto con los números de correlativos faltantes exactos.
 */
export function analizarSecuencias(docs) {
  const grupos = new Map();
  for (const d of docs) {
    const k = `${d.tipo_doc_pago}|${d.serie}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(d);
  }

  const series = [];
  const saltos = [];

  for (const [k, lista] of grupos) {
    const ordenados = [...lista].sort((a, b) => compararCorrelativos(a.correlativo, b.correlativo));
    const sapGaps = detectarSaltosEnSistema(ordenados.filter((d) => d.en_sap));
    const sunatGaps = detectarSaltosEnSistema(ordenados.filter((d) => d.en_sunat));
    const saltosSerie = combinarSaltosPorSistema(sapGaps, sunatGaps);

    for (const s of saltosSerie) {
      saltos.push(s);
    }

    const sistemasSet = new Set(saltosSerie.map((s) => s.sistema));
    let sistemaSalto = null;
    if (sistemasSet.has('AMBOS') || (sistemasSet.has('SAP') && sistemasSet.has('SUNAT'))) {
      sistemaSalto = 'AMBOS';
    } else if (sistemasSet.has('SAP')) {
      sistemaSalto = 'SAP';
    } else if (sistemasSet.has('SUNAT')) {
      sistemaSalto = 'SUNAT';
    }

    const [tipo, serie] = k.split('|');
    series.push({
      tipo_doc_pago: tipo,
      serie,
      documentos: ordenados.length,
      primero: ordenados[0].correlativo,
      ultimo: ordenados[ordenados.length - 1].correlativo,
      fecha_primero: ordenados[0].fecha_emision,
      fecha_ultimo: ordenados[ordenados.length - 1].fecha_emision,
      saltos: saltosSerie.length,
      faltantes: saltosSerie.reduce((a, s) => a + s.faltantes, 0),
      sistema_salto: sistemaSalto,
      estado: saltosSerie.length === 0 ? 'CONTINUA' : 'CON SALTOS',
    });
  }

  series.sort((a, b) => a.serie.localeCompare(b.serie));
  saltos.sort(
    (a, b) =>
      a.serie.localeCompare(b.serie) ||
      (a.start < b.start ? -1 : a.start > b.start ? 1 : 0)
  );

  return { series, saltos };
}

/**
 * Identifica saltos de numeración en SAP, SUNAT o AMBOS.
 * No considera la diferencia de fechas como error.
 * Agrega OBS 3 al documento posterior al salto y devuelve el resumen por serie.
 */
export function validarSecuencias(docs) {
  const { series, saltos } = analizarSecuencias(docs);
  for (const s of saltos) {
    if (s.doc) {
      s.doc.incidencias.push(construirIncidenciaObs3(s));
    }
  }
  return series;
}

/**
 * Enriquecimiento idempotente en memoria para períodos ya cargados en BD:
 * actualiza las incidencias OBS 3 con los correlativos faltantes exactos y
 * el sistema afectado (SAP, SUNAT o AMBOS) sin requerir recarga de archivos.
 */
export function enriquecerSecuenciasEnDocs(docs) {
  if (!Array.isArray(docs) || docs.length === 0) return docs;
  const { saltos } = analizarSecuencias(docs);
  const saltosPorClave = new Map();
  for (const s of saltos) {
    if (!s.doc) continue;
    const k = s.doc.key || `${s.doc.tipo_doc_pago}|${s.doc.serie}|${correlativoCanonico(s.doc.correlativo)}`;
    if (!saltosPorClave.has(k)) saltosPorClave.set(k, []);
    saltosPorClave.get(k).push(s);
  }

  return docs.map((d) => {
    const k = d.key || `${d.tipo_doc_pago}|${d.serie}|${correlativoCanonico(d.correlativo)}`;
    const nuevosSaltos = saltosPorClave.get(k) || [];
    const tieneObs3Prev = Array.isArray(d.incidencias) && d.incidencias.some((i) => i.codigo === 'OBS 3');
    if (nuevosSaltos.length === 0 && !tieneObs3Prev) return d;

    const otrasIncidencias = (d.incidencias || []).filter((i) => i.codigo !== 'OBS 3');
    const nuevasObs3 = nuevosSaltos.map(construirIncidenciaObs3);
    const incidencias = [...otrasIncidencias, ...nuevasObs3];
    const codigos = [...new Set(incidencias.filter((i) => i.tipo !== TIPO.INFO).map((i) => i.codigo))];
    const estado = estadoGeneral(incidencias);

    return { ...d, incidencias, codigos, estado };
  });
}

/** Estado general: ERROR > OBSERVADO > OK. */
export function estadoGeneral(incidencias) {
  if (incidencias.some((i) => i.tipo === 'ERROR')) return 'ERROR';
  if (incidencias.some((i) => i.tipo === 'OBS')) return 'OBSERVADO';
  return 'OK';
}
