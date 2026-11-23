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
const STREAM_CHUNK_BYTES = 8 * 1024 * 1024; // 8 MB por bloque para archivos hasta 400 MB sin exceder límite de strings V8

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

/**
 * Recorre las líneas de un archivo (`File`/`Blob`), `ArrayBuffer`/`Uint8Array` o `string`
 * en streaming por bloques de 8 MB sin cargar un string gigante de 400 MB en memoria.
 * Si `onLine(line, lineNumber, isLast)` devuelve `false`, detiene la lectura de inmediato.
 */
export async function iterarLineasStreaming(source, onLine) {
  if (typeof source === 'string') {
    const len = source.length;
    let pos = 0;
    let lineNum = 0;
    while (pos <= len) {
      const nl = source.indexOf('\n', pos);
      const isLast = nl === -1;
      const end = isLast ? len : nl;
      const lineEnd = end > pos && source.charCodeAt(end - 1) === 13 ? end - 1 : end;
      lineNum += 1;
      if (onLine(source.slice(pos, lineEnd), lineNum, isLast) === false) break;
      if (isLast) break;
      pos = nl + 1;
    }
    return { codificacion: 'UTF-8' };
  }

  const isBlob = source && typeof source.slice === 'function' && typeof source.arrayBuffer === 'function' && typeof source.size === 'number';
  const totalBytes = isBlob
    ? source.size
    : source instanceof ArrayBuffer
      ? source.byteLength
      : ArrayBuffer.isView(source)
        ? source.byteLength
        : 0;

  if (totalBytes === 0) {
    return { codificacion: 'UTF-8' };
  }

  const fullView = isBlob
    ? null
    : source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);

  // Detectar codificación (UTF-8 vs Windows-1252) y BOM sobre los primeros 64 KB
  const probeLen = Math.min(totalBytes, 65536);
  const probeBytes = isBlob
    ? new Uint8Array(await source.slice(0, probeLen).arrayBuffer())
    : fullView.subarray(0, probeLen);

  let hasBom = probeBytes.length >= 3 && probeBytes[0] === 0xef && probeBytes[1] === 0xbb && probeBytes[2] === 0xbf;
  let encoding = 'utf-8';
  let codificacion = hasBom ? 'UTF-8 (BOM)' : 'UTF-8';
  try {
    // Recortar hasta el último salto de línea en la sonda para no cortar una secuencia UTF-8 multibyte
    let safeProbeEnd = probeBytes.length;
    if (probeLen < totalBytes) {
      const lastNl = probeBytes.lastIndexOf(10);
      if (lastNl > 0) safeProbeEnd = lastNl + 1;
    }
    new TextDecoder('utf-8', { fatal: true }).decode(probeBytes.subarray(hasBom ? 3 : 0, safeProbeEnd));
  } catch {
    encoding = 'windows-1252';
    codificacion = 'Windows-1252';
    hasBom = false;
  }

  let decoder = new TextDecoder(encoding, encoding === 'utf-8' ? { fatal: true } : undefined);
  let offset = hasBom ? 3 : 0;
  let carry = '';
  let lineNum = 0;
  let stopped = false;

  const decodeSlice = (bytes) => {
    try {
      return decoder.decode(bytes);
    } catch {
      // Fallback automático si aparece un byte Latin-1/Windows-1252 más adelante en el archivo
      encoding = 'windows-1252';
      codificacion = 'Windows-1252';
      decoder = new TextDecoder('windows-1252');
      return decoder.decode(bytes);
    }
  };

  while (offset < totalBytes && !stopped) {
    const end = Math.min(offset + STREAM_CHUNK_BYTES, totalBytes);
    const isFinalChunk = end >= totalBytes;
    const rawChunk = isBlob
      ? new Uint8Array(await source.slice(offset, end).arrayBuffer())
      : fullView.subarray(offset, end);

    let sliceToDecode = rawChunk;
    if (!isFinalChunk) {
      const lastNl = rawChunk.lastIndexOf(10);
      if (lastNl !== -1) {
        sliceToDecode = rawChunk.subarray(0, lastNl + 1);
        offset += lastNl + 1;
      } else {
        offset = end;
      }
    } else {
      offset = end;
    }

    const chunkText = carry + decodeSlice(sliceToDecode);
    carry = '';

    const textLen = chunkText.length;
    let pos = 0;
    while (pos < textLen) {
      const nl = chunkText.indexOf('\n', pos);
      if (nl === -1) {
        if (isFinalChunk) {
          const lineEnd = textLen > pos && chunkText.charCodeAt(textLen - 1) === 13 ? textLen - 1 : textLen;
          lineNum += 1;
          if (onLine(chunkText.slice(pos, lineEnd), lineNum, true) === false) stopped = true;
        } else {
          carry = chunkText.slice(pos);
        }
        break;
      }
      const lineEnd = nl > pos && chunkText.charCodeAt(nl - 1) === 13 ? nl - 1 : nl;
      const isLastLineOfFile = isFinalChunk && nl === textLen - 1;
      lineNum += 1;
      if (onLine(chunkText.slice(pos, lineEnd), lineNum, isLastLineOfFile) === false) {
        stopped = true;
        break;
      }
      pos = nl + 1;
    }
  }

  if (!stopped && carry.length > 0) {
    lineNum += 1;
    const lineEnd = carry.charCodeAt(carry.length - 1) === 13 ? carry.length - 1 : carry.length;
    onLine(carry.slice(0, lineEnd), lineNum, true);
  }

  return { codificacion };
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

/** Elimina duplicados por clave (se conserva la primera aparición) y los reporta en O(N). */
function marcarDuplicados(res) {
  const vistos = new Map();
  const dupPorClave = new Map();
  const unicos = [];
  for (const r of res.registros) {
    const previo = vistos.get(r.clave);
    if (previo) {
      let dup = dupPorClave.get(r.clave);
      if (!dup) {
        dup = { clave: r.clave, folio: `${r.serie}-${r.correlativo}`, lineas: [previo.linea] };
        dupPorClave.set(r.clave, dup);
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

function crearProcesadorSapVentas() {
  const res = nuevoResultado('SAP');
  const periodos = new Map();
  let primeraProcesada = false;

  const procesarLinea = (raw, nLinea, isLast) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      if (!isLast) res.lineasVacias += 1;
      return true;
    }
    if (!primeraProcesada) {
      primeraProcesada = true;
      if (/car sunat|serie del cdp/i.test(trimmed)) {
        res.estado = 'error';
        res.mensaje = 'El archivo tiene cabecera de reporte SUNAT. Cárguelo en la casilla "Archivo SUNAT".';
        return false;
      }
    }
    res.totalLineas += 1;
    const c = raw.split('|');
    if (c.length < SAP_MIN_COLUMNAS) {
      if (c.every((v) => !v.trim())) {
        res.lineasVacias += 1;
        return true;
      }
      res.registrosLeidos += 1;
      if (res.registrosIncompletos.length < MAX_DETALLE) {
        res.registrosIncompletos.push({ linea: nLinea, columnas: c.length });
      }
      return true;
    }
    res.registrosLeidos += 1;
    const tipoRaw = (c[5] ?? '').trim();
    const tipo = normalizarTipoCP(tipoRaw);
    const serie = (c[6] ?? '').trim().toUpperCase();
    const correlativo = (c[7] ?? '').trim();
    if (!/^\d{2}$/.test(tipo)) registrarErrorTipo(res, nLinea, 'Tipo CP', tipoRaw);
    if (!serie || !correlativo) {
      registrarErrorTipo(res, nLinea, 'Serie/Número', `${serie}-${correlativo}`);
      return true;
    }
    if (!/^\d+$/.test(correlativo)) registrarErrorTipo(res, nLinea, 'Correlativo', correlativo);
    const per = (c[0] ?? '').trim();
    if (per) periodos.set(per, (periodos.get(per) || 0) + 1);
    res.registros.push({
      linea: nLinea,
      clave: claveDocumento(tipo, serie, correlativo),
      periodo: per,
      fecha_emision: fecha(res, nLinea, 'Fecha emisión', (c[3] ?? '').trim()),
      tipo_doc_pago: tipo,
      serie,
      correlativo,
      tipo_identidad: (c[9] ?? '').trim(),
      nro_identidad: (c[10] ?? '').trim(),
      nombre: (c[11] ?? '').trim(),
      base: monto(res, nLinea, 'BI Gravada', (c[13] ?? '').trim()),
      igv: monto(res, nLinea, 'IGV', (c[15] ?? '').trim()),
      exonerado: monto(res, nLinea, 'Exonerado', (c[17] ?? '').trim()),
      inafecto: monto(res, nLinea, 'Inafecto', (c[18] ?? '').trim()),
      otros: monto(res, nLinea, 'Otros tributos', (c[23] ?? '').trim()),
      total: monto(res, nLinea, 'Total', (c[24] ?? '').trim()),
      op_gratuitas: 0,
      estado: (c[34] ?? '').trim() || '1',
    });
    return true;
  };

  const finalizar = () => {
    if (res.estado === 'error') return res;
    if (res.registrosLeidos > 0 && res.registrosIncompletos.length / res.registrosLeidos > 0.5) {
      res.estado = 'error';
      res.mensaje = `Estructura no reconocida: más del 50% de las líneas tiene menos de ${SAP_MIN_COLUMNAS} columnas.`;
      return res;
    }
    const per = [...periodos.entries()].sort((a, b) => b[1] - a[1])[0];
    if (per) res.periodoDetectado = per[0].slice(0, 6);
    if (periodos.size > 1) res.advertencias.push(`El archivo contiene ${periodos.size} períodos distintos.`);
    return cerrarResultado(res);
  };

  return { procesarLinea, finalizar };
}

export function parsearSapVentas(texto) {
  const { procesarLinea, finalizar } = crearProcesadorSapVentas();
  const str = String(texto ?? '');
  const len = str.length;
  let pos = 0;
  let lineNum = 0;
  while (pos <= len) {
    const nl = str.indexOf('\n', pos);
    const isLast = nl === -1;
    const end = isLast ? len : nl;
    const lineEnd = end > pos && str.charCodeAt(end - 1) === 13 ? end - 1 : end;
    lineNum += 1;
    if (procesarLinea(str.slice(pos, lineEnd), lineNum, isLast) === false) break;
    if (isLast) break;
    pos = nl + 1;
  }
  return finalizar();
}

export async function parsearSapVentasStreaming(source) {
  const { procesarLinea, finalizar } = crearProcesadorSapVentas();
  const { codificacion } = await iterarLineasStreaming(source, procesarLinea);
  const res = finalizar();
  res.codificacion = codificacion;
  return res;
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

function crearProcesadorSunatVentas() {
  const res = nuevoResultado('SUNAT');
  const periodos = new Map();
  const rucs = new Map();
  let cabeceraLeida = false;
  let nCab = 0;
  let maxIdx = 0;
  let iRuc = -1;
  let iPer = -1;
  let iCar = -1;
  let iFecha = -1;
  let iTipo = -1;
  let iSerie = -1;
  let iCorr = -1;
  let iTipoId = -1;
  let iNroId = -1;
  let iNombre = -1;
  let iBase = -1;
  let iIgv = -1;
  let iExo = -1;
  let iInaf = -1;
  let iOtros = -1;
  let iTotal = -1;
  let iEstado = -1;
  let iOpGrat = -1;

  const procesarLinea = (raw, nLinea, isLast) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      if (cabeceraLeida && !isLast) res.lineasVacias += 1;
      return true;
    }

    if (!cabeceraLeida) {
      cabeceraLeida = true;
      const cab = raw.split('|').map(normalizarCabecera);
      const mapa = {};
      for (const [campo, def] of Object.entries(SUNAT_CABECERAS)) {
        const i = cab.findIndex((h) => def.nombres.includes(h));
        if (i >= 0) mapa[campo] = i;
        else if (def.requerida) res.columnasFaltantes.push(def.nombres[0]);
      }
      if (mapa.serie === undefined && mapa.correlativo === undefined) {
        res.estado = 'error';
        res.columnasFaltantes = [];
        res.mensaje = /^\d{8}\|/.test(raw)
          ? 'El archivo parece un TXT de SAP (sin cabecera). Cárguelo en la casilla "Archivo SAP".'
          : 'Estructura no reconocida: no se encontró la cabecera del reporte SUNAT (Serie del CDP, Nro CP...).';
        return false;
      }
      if (res.columnasFaltantes.length) {
        res.estado = 'error';
        res.mensaje = `Faltan columnas obligatorias: ${res.columnasFaltantes.join(', ')}.`;
        return false;
      }
      nCab = cab.length;
      maxIdx = Math.max(...Object.values(mapa));
      iRuc = mapa.ruc ?? -1;
      iPer = mapa.periodo ?? -1;
      iCar = mapa.car_sunat ?? -1;
      iFecha = mapa.fecha_emision ?? -1;
      iTipo = mapa.tipo_doc_pago ?? -1;
      iSerie = mapa.serie ?? -1;
      iCorr = mapa.correlativo ?? -1;
      iTipoId = mapa.tipo_identidad ?? -1;
      iNroId = mapa.nro_identidad ?? -1;
      iNombre = mapa.nombre ?? -1;
      iBase = mapa.base ?? -1;
      iIgv = mapa.igv ?? -1;
      iExo = mapa.exonerado ?? -1;
      iInaf = mapa.inafecto ?? -1;
      iOtros = mapa.otros ?? -1;
      iTotal = mapa.total ?? -1;
      iEstado = mapa.estado ?? -1;
      iOpGrat = mapa.op_gratuitas ?? -1;
      return true;
    }

    res.totalLineas += 1;
    const c = raw.split('|');
    if (c.length <= maxIdx) {
      if (c.every((v) => !v.trim())) {
        res.lineasVacias += 1;
        return true;
      }
      res.registrosLeidos += 1;
      if (res.registrosIncompletos.length < MAX_DETALLE) {
        res.registrosIncompletos.push({ linea: nLinea, columnas: c.length, esperadas: nCab });
      }
      return true;
    }
    res.registrosLeidos += 1;

    const tipoRaw = iTipo >= 0 ? (c[iTipo] ?? '').trim() : '';
    const tipo = normalizarTipoCP(tipoRaw);
    const serie = iSerie >= 0 ? (c[iSerie] ?? '').trim().toUpperCase() : '';
    const correlativo = iCorr >= 0 ? (c[iCorr] ?? '').trim() : '';
    if (!/^\d{2}$/.test(tipo)) registrarErrorTipo(res, nLinea, 'Tipo CP', tipoRaw);
    if (!serie || !correlativo) {
      registrarErrorTipo(res, nLinea, 'Serie/Número', `${serie}-${correlativo}`);
      return true;
    }
    if (!/^\d+$/.test(correlativo)) registrarErrorTipo(res, nLinea, 'Correlativo', correlativo);
    const per = iPer >= 0 ? (c[iPer] ?? '').trim() : '';
    if (per) periodos.set(per, (periodos.get(per) || 0) + 1);
    const ruc = iRuc >= 0 ? (c[iRuc] ?? '').trim() : '';
    if (ruc) rucs.set(ruc, (rucs.get(ruc) || 0) + 1);

    res.registros.push({
      linea: nLinea,
      clave: claveDocumento(tipo, serie, correlativo),
      periodo: per,
      car_sunat: iCar >= 0 ? (c[iCar] ?? '').trim() : '',
      fecha_emision: fecha(res, nLinea, 'Fecha emisión', iFecha >= 0 ? (c[iFecha] ?? '').trim() : ''),
      tipo_doc_pago: tipo,
      serie,
      correlativo,
      tipo_identidad: iTipoId >= 0 ? (c[iTipoId] ?? '').trim() : '',
      nro_identidad: iNroId >= 0 ? (c[iNroId] ?? '').trim() : '',
      nombre: iNombre >= 0 ? (c[iNombre] ?? '').trim() : '',
      base: monto(res, nLinea, 'BI Gravada', iBase >= 0 ? (c[iBase] ?? '').trim() : ''),
      igv: monto(res, nLinea, 'IGV / IPM', iIgv >= 0 ? (c[iIgv] ?? '').trim() : ''),
      exonerado: monto(res, nLinea, 'Mto Exonerado', iExo >= 0 ? (c[iExo] ?? '').trim() : ''),
      inafecto: monto(res, nLinea, 'Mto Inafecto', iInaf >= 0 ? (c[iInaf] ?? '').trim() : ''),
      otros: monto(res, nLinea, 'Otros Tributos', iOtros >= 0 ? (c[iOtros] ?? '').trim() : ''),
      total: monto(res, nLinea, 'Total CP', iTotal >= 0 ? (c[iTotal] ?? '').trim() : ''),
      op_gratuitas: monto(res, nLinea, 'Valor OP Gratuitas', iOpGrat >= 0 ? (c[iOpGrat] ?? '').trim() : ''),
      estado: (iEstado >= 0 ? (c[iEstado] ?? '').trim() : '') || '1',
    });
    return true;
  };

  const finalizar = () => {
    if (res.estado === 'error') return res;
    if (!cabeceraLeida) {
      res.estado = 'error';
      res.mensaje = 'El archivo está vacío.';
      return res;
    }
    const per = [...periodos.entries()].sort((a, b) => b[1] - a[1])[0];
    if (per) res.periodoDetectado = per[0].slice(0, 6);
    const ruc = [...rucs.entries()].sort((a, b) => b[1] - a[1])[0];
    if (ruc) res.rucDetectado = ruc[0];
    if (periodos.size > 1) res.advertencias.push(`El archivo contiene ${periodos.size} períodos distintos.`);
    if (rucs.size > 1) res.advertencias.push(`El archivo contiene ${rucs.size} RUC distintos.`);
    return cerrarResultado(res);
  };

  return { procesarLinea, finalizar };
}

export function parsearSunatVentas(texto) {
  const { procesarLinea, finalizar } = crearProcesadorSunatVentas();
  const str = String(texto ?? '');
  const len = str.length;
  let pos = 0;
  let lineNum = 0;
  while (pos <= len) {
    const nl = str.indexOf('\n', pos);
    const isLast = nl === -1;
    const end = isLast ? len : nl;
    const lineEnd = end > pos && str.charCodeAt(end - 1) === 13 ? end - 1 : end;
    lineNum += 1;
    if (procesarLinea(str.slice(pos, lineEnd), lineNum, isLast) === false) break;
    if (isLast) break;
    pos = nl + 1;
  }
  return finalizar();
}

export async function parsearSunatVentasStreaming(source) {
  const { procesarLinea, finalizar } = crearProcesadorSunatVentas();
  const { codificacion } = await iterarLineasStreaming(source, procesarLinea);
  const res = finalizar();
  res.codificacion = codificacion;
  return res;
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
