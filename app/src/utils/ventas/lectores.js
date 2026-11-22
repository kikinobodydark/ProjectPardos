// ============================================================================
// Lectores de archivos del módulo de Ventas con validación de carga.
//  - SAP   : TXT sin cabecera, delimitado por "|" (formato PLE 14.1 / 1111).
//  - SUNAT : TXT con cabecera, delimitado por "|" (propuesta RVIE - EXP2).
//  - Cortesías (opcional): Excel con columna "Documento".
// Los archivos originales nunca se modifican: solo se leen en memoria.
// ============================================================================
import { parseMontoCentimos } from './montos.js';
import { normalizarTipoCP, normalizarFecha, claveDocumento, normalizarNumeroDocumento } from './documento.js';

const MAX_DETALLE = 200; // límite de incidencias detalladas a guardar por tipo

/** Decodifica un ArrayBuffer: intenta UTF-8 estricto y, si falla, Windows-1252. Quita BOM. */
export function decodificarTexto(buffer) {
  let texto;
  let codificacion = 'UTF-8';
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    texto = new TextDecoder('windows-1252').decode(buffer);
    codificacion = 'Windows-1252';
  }
  if (texto.charCodeAt(0) === 0xfeff) {
    texto = texto.slice(1);
    codificacion += ' (BOM)';
  }
  return { texto, codificacion };
}

const normalizarCabecera = (h) =>
  String(h ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

function nuevoResultado(origen) {
  return {
    origen,
    formato: 'TXT delimitado por "|"',
    estado: 'ok', // ok | advertencia | error
    mensaje: '',
    totalLineas: 0,
    registrosLeidos: 0,
    registrosValidos: 0,
    lineasVacias: 0,
    registrosIncompletos: [], // { linea, columnas }
    erroresTipo: [], // { linea, campo, valor }
    totalErroresTipo: 0,
    duplicados: [], // { clave, folio, lineas: [] }
    columnasFaltantes: [],
    advertencias: [],
    periodoDetectado: null,
    rucDetectado: null,
    registros: [],
  };
}

function registrarErrorTipo(res, linea, campo, valor) {
  res.totalErroresTipo += 1;
  if (res.erroresTipo.length < MAX_DETALLE) res.erroresTipo.push({ linea, campo, valor: String(valor ?? '') });
}

function monto(res, linea, campo, valor) {
  const r = parseMontoCentimos(valor);
  if (!r.ok) registrarErrorTipo(res, linea, campo, valor);
  return r.value;
}

function fecha(res, linea, campo, valor) {
  const r = normalizarFecha(valor);
  if (!r.ok) registrarErrorTipo(res, linea, campo, valor);
  return r.value;
}

/** Elimina duplicados por clave (se conserva la primera aparición) y los reporta. */
function marcarDuplicados(res) {
  const vistos = new Map();
  const unicos = [];
  for (const r of res.registros) {
    const previo = vistos.get(r.clave);
    if (previo) {
      let dup = res.duplicados.find((d) => d.clave === r.clave);
      if (!dup) {
        dup = { clave: r.clave, folio: `${r.serie}-${r.correlativo}`, lineas: [previo.linea] };
        res.duplicados.push(dup);
      }
      dup.lineas.push(r.linea);
    } else {
      vistos.set(r.clave, r);
      unicos.push(r);
    }
  }
  res.registros = unicos;
}

function cerrarResultado(res) {
  marcarDuplicados(res);
  res.registrosValidos = res.registros.length;
  if (res.estado !== 'error') {
    if (res.registrosValidos === 0) {
      res.estado = 'error';
      res.mensaje = 'No se encontraron registros válidos en el archivo.';
    } else if (
      res.registrosIncompletos.length || res.totalErroresTipo || res.duplicados.length || res.advertencias.length
    ) {
      res.estado = 'advertencia';
      res.mensaje = `${res.registrosValidos.toLocaleString('es-PE')} comprobantes únicos leídos con observaciones de lectura.`;
    } else {
      res.mensaje = `${res.registrosValidos.toLocaleString('es-PE')} comprobantes únicos leídos correctamente.`;
    }
  }
  return res;
}

// ---------------------------------------------------------------------------
// SAP (sin cabecera). Posiciones según PLE 14.1 (Registro de Ventas).
// ---------------------------------------------------------------------------
export const SAP_COLUMNAS = {
  periodo: 0, cuo: 1, fecha_emision: 3, tipo_doc_pago: 5, serie: 6, correlativo: 7,
  tipo_identidad: 9, nro_identidad: 10, nombre: 11, base: 13, igv: 15, exonerado: 17,
  inafecto: 18, icbper: 22, otros: 23, total: 24, estado: 34,
};
const SAP_MIN_COLUMNAS = 35;

export function parsearSapVentas(texto) {
  const res = nuevoResultado('SAP');
  const lineas = texto.split(/\r?\n/);
  const primera = lineas.find((l) => l.trim()) || '';
  if (/car sunat|serie del cdp/i.test(primera)) {
    res.estado = 'error';
    res.mensaje = 'El archivo tiene cabecera de reporte SUNAT. Cárguelo en la casilla "Archivo SUNAT".';
    return res;
  }
  const periodos = new Map();
  lineas.forEach((raw, idx) => {
    const nLinea = idx + 1;
    if (!raw.trim()) {
      if (idx < lineas.length - 1) res.lineasVacias += 1;
      return;
    }
    res.totalLineas += 1;
    const c = raw.split('|');
    if (c.every((v) => !v.trim())) { res.lineasVacias += 1; return; }
    res.registrosLeidos += 1;
    if (c.length < SAP_MIN_COLUMNAS) {
      if (res.registrosIncompletos.length < MAX_DETALLE) res.registrosIncompletos.push({ linea: nLinea, columnas: c.length });
      return;
    }
    const g = (k) => (c[SAP_COLUMNAS[k]] ?? '').trim();
    const tipo = normalizarTipoCP(g('tipo_doc_pago'));
    const serie = g('serie').toUpperCase();
    const correlativo = g('correlativo');
    if (!/^\d{2}$/.test(tipo)) registrarErrorTipo(res, nLinea, 'Tipo CP', g('tipo_doc_pago'));
    if (!serie || !correlativo) {
      registrarErrorTipo(res, nLinea, 'Serie/Número', `${serie}-${correlativo}`);
      return;
    }
    if (!/^\d+$/.test(correlativo)) registrarErrorTipo(res, nLinea, 'Correlativo', correlativo);
    const per = g('periodo');
    if (per) periodos.set(per, (periodos.get(per) || 0) + 1);
    res.registros.push({
      linea: nLinea,
      clave: claveDocumento(tipo, serie, correlativo),
      periodo: per,
      fecha_emision: fecha(res, nLinea, 'Fecha emisión', g('fecha_emision')),
      tipo_doc_pago: tipo,
      serie,
      correlativo,
      tipo_identidad: g('tipo_identidad'),
      nro_identidad: g('nro_identidad'),
      nombre: g('nombre'),
      base: monto(res, nLinea, 'BI Gravada', g('base')),
      igv: monto(res, nLinea, 'IGV', g('igv')),
      exonerado: monto(res, nLinea, 'Exonerado', g('exonerado')),
      inafecto: monto(res, nLinea, 'Inafecto', g('inafecto')),
      otros: monto(res, nLinea, 'Otros tributos', g('otros')),
      total: monto(res, nLinea, 'Total', g('total')),
      op_gratuitas: 0,
      estado: g('estado') || '1',
    });
  });
  if (res.registrosLeidos > 0 && res.registrosIncompletos.length / res.registrosLeidos > 0.5) {
    res.estado = 'error';
    res.mensaje = `Estructura no reconocida: más del 50% de las líneas tiene menos de ${SAP_MIN_COLUMNAS} columnas.`;
    return res;
  }
  const per = [...periodos.entries()].sort((a, b) => b[1] - a[1])[0];
  if (per) res.periodoDetectado = per[0].slice(0, 6);
  if (periodos.size > 1) res.advertencias.push(`El archivo contiene ${periodos.size} períodos distintos.`);
  return cerrarResultado(res);
}

// ---------------------------------------------------------------------------
// SUNAT (con cabecera). Se mapean las columnas por NOMBRE de cabecera.
// ---------------------------------------------------------------------------
export const SUNAT_CABECERAS = {
  ruc: { nombres: ['ruc'], requerida: true },
  periodo: { nombres: ['periodo'], requerida: false },
  car_sunat: { nombres: ['car sunat'], requerida: false },
  fecha_emision: { nombres: ['fecha de emision'], requerida: true },
  tipo_doc_pago: { nombres: ['tipo cp/doc.', 'tipo cp/doc', 'tipo cp'], requerida: true },
  serie: { nombres: ['serie del cdp'], requerida: true },
  correlativo: { nombres: ['nro cp o doc. nro inicial (rango)', 'nro cp o doc. nro inicial'], requerida: true },
  tipo_identidad: { nombres: ['tipo doc identidad'], requerida: true },
  nro_identidad: { nombres: ['nro doc identidad'], requerida: true },
  nombre: { nombres: ['apellidos nombres/ razon social', 'apellidos nombres/razon social'], requerida: true },
  base: { nombres: ['bi gravada'], requerida: true },
  igv: { nombres: ['igv / ipm', 'igv/ipm'], requerida: true },
  exonerado: { nombres: ['mto exonerado'], requerida: true },
  inafecto: { nombres: ['mto inafecto'], requerida: true },
  icbper: { nombres: ['icbper'], requerida: false },
  otros: { nombres: ['otros tributos'], requerida: true },
  total: { nombres: ['total cp'], requerida: true },
  estado: { nombres: ['est. comp', 'est. comp.'], requerida: false },
  op_gratuitas: { nombres: ['valor op gratuitas'], requerida: false },
};

export function parsearSunatVentas(texto) {
  const res = nuevoResultado('SUNAT');
  const lineas = texto.split(/\r?\n/);
  const idxCab = lineas.findIndex((l) => l.trim());
  if (idxCab < 0) {
    res.estado = 'error';
    res.mensaje = 'El archivo está vacío.';
    return res;
  }
  const cab = lineas[idxCab].split('|').map(normalizarCabecera);
  const mapa = {};
  for (const [campo, def] of Object.entries(SUNAT_CABECERAS)) {
    const i = cab.findIndex((h) => def.nombres.includes(h));
    if (i >= 0) mapa[campo] = i;
    else if (def.requerida) res.columnasFaltantes.push(def.nombres[0]);
  }
  if (mapa.serie === undefined && mapa.correlativo === undefined) {
    res.estado = 'error';
    res.columnasFaltantes = [];
    res.mensaje = /^\d{8}\|/.test(lineas[idxCab])
      ? 'El archivo parece un TXT de SAP (sin cabecera). Cárguelo en la casilla "Archivo SAP".'
      : 'Estructura no reconocida: no se encontró la cabecera del reporte SUNAT (Serie del CDP, Nro CP...).';
    return res;
  }
  if (res.columnasFaltantes.length) {
    res.estado = 'error';
    res.mensaje = `Faltan columnas obligatorias: ${res.columnasFaltantes.join(', ')}.`;
    return res;
  }
  const nCab = cab.length;
  const periodos = new Map();
  const rucs = new Map();
  for (let idx = idxCab + 1; idx < lineas.length; idx++) {
    const raw = lineas[idx];
    const nLinea = idx + 1;
    if (!raw.trim()) {
      if (idx < lineas.length - 1) res.lineasVacias += 1;
      continue;
    }
    res.totalLineas += 1;
    const c = raw.split('|');
    if (c.every((v) => !v.trim())) { res.lineasVacias += 1; continue; }
    res.registrosLeidos += 1;
    const maxIdx = Math.max(...Object.values(mapa));
    if (c.length <= maxIdx) {
      if (res.registrosIncompletos.length < MAX_DETALLE) res.registrosIncompletos.push({ linea: nLinea, columnas: c.length, esperadas: nCab });
      continue;
    }
    const g = (k) => (mapa[k] === undefined ? '' : (c[mapa[k]] ?? '').trim());
    const tipo = normalizarTipoCP(g('tipo_doc_pago'));
    const serie = g('serie').toUpperCase();
    const correlativo = g('correlativo');
    if (!/^\d{2}$/.test(tipo)) registrarErrorTipo(res, nLinea, 'Tipo CP', g('tipo_doc_pago'));
    if (!serie || !correlativo) {
      registrarErrorTipo(res, nLinea, 'Serie/Número', `${serie}-${correlativo}`);
      continue;
    }
    if (!/^\d+$/.test(correlativo)) registrarErrorTipo(res, nLinea, 'Correlativo', correlativo);
    const per = g('periodo');
    if (per) periodos.set(per, (periodos.get(per) || 0) + 1);
    const ruc = g('ruc');
    if (ruc) rucs.set(ruc, (rucs.get(ruc) || 0) + 1);
    res.registros.push({
      linea: nLinea,
      clave: claveDocumento(tipo, serie, correlativo),
      periodo: per,
      car_sunat: g('car_sunat'),
      fecha_emision: fecha(res, nLinea, 'Fecha emisión', g('fecha_emision')),
      tipo_doc_pago: tipo,
      serie,
      correlativo,
      tipo_identidad: g('tipo_identidad'),
      nro_identidad: g('nro_identidad'),
      nombre: g('nombre'),
      base: monto(res, nLinea, 'BI Gravada', g('base')),
      igv: monto(res, nLinea, 'IGV / IPM', g('igv')),
      exonerado: monto(res, nLinea, 'Mto Exonerado', g('exonerado')),
      inafecto: monto(res, nLinea, 'Mto Inafecto', g('inafecto')),
      otros: monto(res, nLinea, 'Otros Tributos', g('otros')),
      total: monto(res, nLinea, 'Total CP', g('total')),
      op_gratuitas: monto(res, nLinea, 'Valor OP Gratuitas', g('op_gratuitas')),
      estado: g('estado') || '1',
    });
  }
  const per = [...periodos.entries()].sort((a, b) => b[1] - a[1])[0];
  if (per) res.periodoDetectado = per[0].slice(0, 6);
  const ruc = [...rucs.entries()].sort((a, b) => b[1] - a[1])[0];
  if (ruc) res.rucDetectado = ruc[0];
  if (periodos.size > 1) res.advertencias.push(`El archivo contiene ${periodos.size} períodos distintos.`);
  if (rucs.size > 1) res.advertencias.push(`El archivo contiene ${rucs.size} RUC distintos.`);
  return cerrarResultado(res);
}

// ---------------------------------------------------------------------------
// Cortesías (Excel opcional). Se usa la columna "Documento" (15 caracteres).
// ---------------------------------------------------------------------------
export function parsearCortesias(filas) {
  const res = nuevoResultado('CORTESIAS');
  res.formato = 'Excel (.xlsx / .xls)';
  res.documentosInvalidos = [];
  if (!filas.length) {
    res.estado = 'error';
    res.mensaje = 'El Excel no contiene filas.';
    return res;
  }
  const columnas = Object.keys(filas[0]);
  const buscar = (nombre) => columnas.find((k) => normalizarCabecera(k) === nombre);
  const colDoc = buscar('documento');
  if (!colDoc) {
    res.estado = 'error';
    res.columnasFaltantes = ['Documento'];
    res.mensaje = 'Falta la columna obligatoria "Documento".';
    return res;
  }
  const col = {
    restaurante: buscar('restaurante'), fecha: buscar('fecha'), neto: buscar('neto'), igv: buscar('igv'),
    servicios: buscar('servicios'), total: buscar('total'), tipoPago: buscar('tipopago'),
    observacion: buscar('observacion'), detalle: buscar('detalle cortesia'),
  };
  filas.forEach((f, i) => {
    const nLinea = i + 2; // fila 1 = cabecera
    res.totalLineas += 1;
    const doc = String(f[colDoc] ?? '').trim();
    if (!doc) { res.lineasVacias += 1; return; } // filas de totales / filtros aplicados
    res.registrosLeidos += 1;
    const n = normalizarNumeroDocumento(doc);
    if (!n.valido) {
      res.documentosInvalidos.push({ linea: nLinea, documento: doc, motivo: n.motivo });
      registrarErrorTipo(res, nLinea, 'Documento', `${doc} (${n.motivo})`);
      return;
    }
    const v = (k) => (col[k] ? String(f[col[k]] ?? '').trim() : '');
    res.registros.push({
      linea: nLinea,
      clave: n.clave,
      documento: doc,
      tipo_doc_pago: n.tipo_doc_pago,
      serie: n.serie,
      correlativo: n.correlativo,
      restaurante: v('restaurante'),
      fecha: v('fecha'),
      neto: parseMontoCentimos(v('neto')).value,
      igv: parseMontoCentimos(v('igv')).value,
      servicios: parseMontoCentimos(v('servicios')).value,
      total: parseMontoCentimos(v('total')).value,
      tipo_pago: v('tipoPago'),
      observacion: v('observacion'),
      detalle: v('detalle'),
    });
  });
  return cerrarResultado(res);
}
