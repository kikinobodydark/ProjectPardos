// ============================================================================
// Lectores de archivos TXT del módulo de Compras (SAP y SUNAT únicamente).
//  - SAP   : TXT sin cabecera delimitado por "|" (PLE 8.1 Registro de Compras).
//  - SUNAT : TXT con cabecera delimitado por "|" (Propuesta SIRE RCE).
//
// Reglas técnicas:
//  - Nunca modifica los archivos originales (solo lectura en memoria).
//  - Mantiene ceros a la izquierda de series y correlativos.
//  - Utiliza precisión decimal en céntimos enteros para importes.
//  - Detecta y reporta registros duplicados en el archivo de origen sin
//    generar duplicidades en el resultado de conciliación.
// ============================================================================
import { parseMontoCentimos } from '../ventas/montos.js';
import { decodificarTexto } from '../ventas/lectores.js';
import {
  normalizarTipoDocCompras,
  normalizarTipoIdentidad,
  normalizarRucProveedor,
  normalizarSerieCompras,
  normalizarCorrelativoCompras,
  normalizarFecha,
  limpiarTextoDescriptivo,
  construirClaveCompras,
  construirClaveLegible,
} from './documento.js';

export { decodificarTexto };

const MAX_DETALLE = 200;

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
    duplicados: [], // { clave, claveLegible, folio, ruc, lineas: [] }
    columnasFaltantes: [],
    advertencias: [],
    periodoDetectado: null,
    rucDetectado: null,
    registros: [],
  };
}

function registrarErrorTipo(res, linea, campo, valor) {
  res.totalErroresTipo += 1;
  if (res.erroresTipo.length < MAX_DETALLE) {
    res.erroresTipo.push({ linea, campo, valor: String(valor ?? '') });
  }
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

/**
 * Identifica registros duplicados en el archivo de origen por la clave única
 * (RUC + Tipo + Serie + Correlativo). Conserva la primera aparición para evitar
 * duplicidades en la conciliación y guarda la trazabilidad de líneas duplicadas.
 */
function procesarDuplicados(res) {
  const vistos = new Map();
  const unicos = [];
  for (const r of res.registros) {
    const previo = vistos.get(r.clave);
    if (previo) {
      let dup = res.duplicados.find((d) => d.clave === r.clave);
      if (!dup) {
        dup = {
          clave: r.clave,
          claveLegible: r.clave_legible,
          folio: `${r.serie}-${r.correlativo}`,
          ruc: r.nro_identidad,
          lineas: [previo.linea],
        };
        res.duplicados.push(dup);
        previo.duplicado_en_origen = true;
        previo.lineas_duplicadas = dup.lineas;
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
  procesarDuplicados(res);
  res.registrosValidos = res.registros.length;
  if (res.estado !== 'error') {
    if (res.registrosValidos === 0) {
      res.estado = 'error';
      res.mensaje = 'No se encontraron registros válidos en el archivo.';
    } else if (
      res.registrosIncompletos.length ||
      res.totalErroresTipo ||
      res.duplicados.length ||
      res.advertencias.length
    ) {
      res.estado = 'advertencia';
      res.mensaje = `${res.registrosValidos.toLocaleString('es-PE')} documentos únicos leídos con observaciones de lectura.`;
    } else {
      res.mensaje = `${res.registrosValidos.toLocaleString('es-PE')} documentos únicos leídos correctamente.`;
    }
  }
  return res;
}

// ---------------------------------------------------------------------------
// SAP Compras (sin cabecera). Posiciones estándar PLE 8.1 Registro de Compras.
// ---------------------------------------------------------------------------
export const SAP_COMPRAS_COLUMNAS = {
  periodo: 0,
  doc_interno: 1,
  sociedad: 2,
  fecha_emision: 3,
  fecha_vencimiento: 4,
  tipo_doc_pago: 5,
  serie: 6,
  anio_dua: 7,
  correlativo: 8,
  nro_final: 9,
  tipo_identidad: 10,
  nro_identidad: 11, // RUC del proveedor
  nombre: 12,        // Razón social del proveedor
  base: 13,          // BI Gravado DG
  igv: 14,           // IGV / IPM DG
  bi_dgng: 15,
  igv_dgng: 16,
  exonerado: 17,     // BI Gravado DNG
  igv_dng: 18,
  valor_adquisicion: 19, // Valor Adq. NG
  isc: 20,
  icbper: 21,
  otros: 22,         // Otros Trib/ Cargos
  total: 23,         // Total CP
};

const SAP_COMPRAS_MIN_COLUMNAS = 24;

export function parsearSapCompras(texto) {
  const res = nuevoResultado('SAP');
  const lineas = String(texto ?? '').split(/\r?\n/);
  const primera = lineas.find((l) => l.trim()) || '';

  if (/car sunat|serie del cdp|valor adq\.\s*ng/i.test(primera)) {
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
    if (c.every((v) => !v.trim())) {
      res.lineasVacias += 1;
      return;
    }

    // Saltar posible cabecera textual en caso de que un export SAP incluya títulos
    if (idx === 0 && /periodo|fecha.*emisi|tipo.*doc/i.test(raw)) {
      res.advertencias.push('Se omitió una fila de cabecera detectada en la línea 1 del archivo SAP.');
      return;
    }

    res.registrosLeidos += 1;
    if (c.length < SAP_COMPRAS_MIN_COLUMNAS) {
      if (res.registrosIncompletos.length < MAX_DETALLE) {
        res.registrosIncompletos.push({ linea: nLinea, columnas: c.length });
      }
      return;
    }

    const g = (k) => (c[SAP_COMPRAS_COLUMNAS[k]] ?? '').trim();
    const tipoRaw = g('tipo_doc_pago');
    const tipo = normalizarTipoDocCompras(tipoRaw);
    const serie = normalizarSerieCompras(g('serie'));
    const correlativo = normalizarCorrelativoCompras(g('correlativo'));
    const tipoIdentidad = normalizarTipoIdentidad(g('tipo_identidad'));
    const nroIdentidad = normalizarRucProveedor(g('nro_identidad'));

    if (!tipo) registrarErrorTipo(res, nLinea, 'Tipo de documento', tipoRaw);
    if (!serie && !correlativo) {
      registrarErrorTipo(res, nLinea, 'Serie/Correlativo', `${serie}-${correlativo}`);
      return;
    }

    const per = g('periodo');
    if (per && /^\d{6}/.test(per)) {
      const p6 = per.slice(0, 6);
      periodos.set(p6, (periodos.get(p6) || 0) + 1);
    }

    const clave = construirClaveCompras(nroIdentidad, tipo, serie, correlativo);
    const claveLegible = construirClaveLegible(nroIdentidad, tipo, serie, correlativo);

    res.registros.push({
      linea: nLinea,
      clave,
      clave_legible: claveLegible,
      periodo: per,
      doc_interno: g('doc_interno'),
      fecha_emision: fecha(res, nLinea, 'Fecha de emisión', g('fecha_emision')),
      tipo_doc_pago: tipo,
      tipo_doc_original: tipoRaw,
      serie,
      correlativo,
      tipo_identidad: tipoIdentidad,
      nro_identidad: nroIdentidad,
      nombre: limpiarTextoDescriptivo(g('nombre')),
      base: monto(res, nLinea, 'Base', g('base')),
      igv: monto(res, nLinea, 'IGV', g('igv')),
      exonerado: monto(res, nLinea, 'BI Gravado DNG', g('exonerado')),
      valor_adquisicion: monto(res, nLinea, 'Valor de Adquisición', g('valor_adquisicion')),
      otros: monto(res, nLinea, 'Otros Tributos / Cargos', g('otros')),
      total: monto(res, nLinea, 'Monto Total', g('total')),
      duplicado_en_origen: false,
      lineas_duplicadas: null,
    });
  });

  if (res.registrosLeidos > 0 && res.registrosIncompletos.length / res.registrosLeidos > 0.5) {
    res.estado = 'error';
    res.mensaje = `Estructura no reconocida: más del 50% de las líneas tiene menos de ${SAP_COMPRAS_MIN_COLUMNAS} columnas.`;
    return res;
  }

  const per = [...periodos.entries()].sort((a, b) => b[1] - a[1])[0];
  if (per) res.periodoDetectado = per[0];
  if (periodos.size > 1) {
    res.advertencias.push(`El archivo SAP contiene ${periodos.size} períodos distintos.`);
  }

  return cerrarResultado(res);
}

// ---------------------------------------------------------------------------
// SUNAT Compras (con cabecera). Mapeo por NOMBRE de cabecera (SIRE RCE)
// con soporte a variantes ortográficas y fallback posicional estándar.
// ---------------------------------------------------------------------------
export const SUNAT_COMPRAS_CABECERAS = {
  ruc_empresa: { nombres: ['ruc'], requerida: false },
  periodo: { nombres: ['periodo'], requerida: false },
  car_sunat: { nombres: ['car sunat'], requerida: false },
  fecha_emision: { nombres: ['fecha de emision', 'fecha emision'], requerida: true },
  tipo_doc_pago: { nombres: ['tipo cp/doc.', 'tipo cp/doc', 'tipo cp', 'tipo doc'], requerida: true },
  serie: { nombres: ['serie del cdp', 'serie'], requerida: true },
  correlativo: {
    nombres: [
      'nro cp o doc. nro inicial (rango)',
      'nro cp o doc. nro inicial',
      'nro cp o doc nro inicial (rango)',
      'nro cp',
      'correlativo',
    ],
    requerida: true,
  },
  tipo_identidad: { nombres: ['tipo doc identidad', 'tipo doc. identidad'], requerida: true },
  nro_identidad: { nombres: ['nro doc identidad', 'nro doc. identidad', 'nro. doc. identidad'], requerida: true },
  nombre: {
    nombres: [
      'apellidos nombres/ razon social',
      'apellidos nombres/razon social',
      'apellidos y nombres/ razon social',
      'razon social proveedor',
    ],
    requerida: false,
  },
  base: { nombres: ['bi gravado dg', 'bi gravada', 'base imponible'], requerida: true },
  igv: { nombres: ['igv / ipm dg', 'igv/ipm dg', 'igv / ipm', 'igv'], requerida: true },
  exonerado: { nombres: ['bi gravado dgng', 'bi gravado dng'], requerida: false },
  valor_adquisicion: {
    nombres: ['valor adq. ng', 'valor adq ng', 'valor de adquisicion', 'valor adquisicion'],
    requerida: true,
  },
  otros: {
    nombres: ['otros trib/ cargos', 'otros trib/cargos', 'otros tributos / cargos', 'otros tributos'],
    requerida: true,
  },
  total: { nombres: ['total cp', 'importe total', 'total'], requerida: true },
  estado: { nombres: ['est. comp', 'est. comp.', 'estado'], requerida: false },
};

export function parsearSunatCompras(texto) {
  const res = nuevoResultado('SUNAT');
  const lineas = String(texto ?? '').split(/\r?\n/);
  const idxCab = lineas.findIndex((l) => l.trim());
  if (idxCab < 0) {
    res.estado = 'error';
    res.mensaje = 'El archivo está vacío.';
    return res;
  }

  const cab = lineas[idxCab].split('|').map(normalizarCabecera);
  const mapa = {};
  for (const [campo, def] of Object.entries(SUNAT_COMPRAS_CABECERAS)) {
    const i = cab.findIndex((h) => def.nombres.includes(h));
    if (i >= 0) mapa[campo] = i;
    else if (def.requerida) res.columnasFaltantes.push(def.nombres[0]);
  }

  // Verificar si se cargó por error un TXT SAP (sin cabecera)
  if (mapa.serie === undefined && mapa.correlativo === undefined) {
    res.estado = 'error';
    res.columnasFaltantes = [];
    res.mensaje = /^\d{8}\|/.test(lineas[idxCab])
      ? 'El archivo parece un TXT de SAP (sin cabecera). Cárguelo en la casilla "Archivo SAP".'
      : 'Estructura no reconocida: no se encontró la cabecera del reporte SUNAT Compras (Serie del CDP, Nro CP, BI Gravado DG...).';
    return res;
  }

  if (res.columnasFaltantes.length) {
    res.estado = 'error';
    res.mensaje = `Faltan columnas obligatorias en el archivo SUNAT: ${res.columnasFaltantes.join(', ')}.`;
    return res;
  }

  const nCab = cab.length;
  const maxIdxRequerido = Math.max(
    ...Object.entries(mapa)
      .filter(([k]) => SUNAT_COMPRAS_CABECERAS[k]?.requerida)
      .map(([, idx]) => idx)
  );
  const periodos = new Map();
  const rucsEmpresa = new Map();

  for (let idx = idxCab + 1; idx < lineas.length; idx++) {
    const raw = lineas[idx];
    const nLinea = idx + 1;
    if (!raw.trim()) {
      if (idx < lineas.length - 1) res.lineasVacias += 1;
      continue;
    }
    res.totalLineas += 1;
    const c = raw.split('|');
    if (c.every((v) => !v.trim())) {
      res.lineasVacias += 1;
      continue;
    }
    res.registrosLeidos += 1;
    if (c.length <= maxIdxRequerido) {
      if (res.registrosIncompletos.length < MAX_DETALLE) {
        res.registrosIncompletos.push({ linea: nLinea, columnas: c.length, esperadas: nCab });
      }
      continue;
    }

    const g = (k) => (mapa[k] === undefined ? '' : (c[mapa[k]] ?? '').trim());
    const tipoRaw = g('tipo_doc_pago');
    const tipo = normalizarTipoDocCompras(tipoRaw);
    const serie = normalizarSerieCompras(g('serie'));
    const correlativo = normalizarCorrelativoCompras(g('correlativo'));
    const tipoIdentidad = normalizarTipoIdentidad(g('tipo_identidad'));
    const nroIdentidad = normalizarRucProveedor(g('nro_identidad'));

    if (!tipo) registrarErrorTipo(res, nLinea, 'Tipo de documento', tipoRaw);
    if (!serie && !correlativo) {
      registrarErrorTipo(res, nLinea, 'Serie/Correlativo', `${serie}-${correlativo}`);
      continue;
    }

    const per = g('periodo');
    if (per && /^\d{6}/.test(per)) {
      const p6 = per.slice(0, 6);
      periodos.set(p6, (periodos.get(p6) || 0) + 1);
    }
    const rucEmp = g('ruc_empresa');
    if (rucEmp) rucsEmpresa.set(rucEmp, (rucsEmpresa.get(rucEmp) || 0) + 1);

    const clave = construirClaveCompras(nroIdentidad, tipo, serie, correlativo);
    const claveLegible = construirClaveLegible(nroIdentidad, tipo, serie, correlativo);

    res.registros.push({
      linea: nLinea,
      clave,
      clave_legible: claveLegible,
      ruc_empresa: rucEmp,
      periodo: per,
      car_sunat: g('car_sunat'),
      fecha_emision: fecha(res, nLinea, 'Fecha de emisión', g('fecha_emision')),
      tipo_doc_pago: tipo,
      tipo_doc_original: tipoRaw,
      serie,
      correlativo,
      tipo_identidad: tipoIdentidad,
      nro_identidad: nroIdentidad,
      nombre: limpiarTextoDescriptivo(g('nombre')),
      base: monto(res, nLinea, 'BI Gravado DG', g('base')),
      igv: monto(res, nLinea, 'IGV / IPM DG', g('igv')),
      exonerado: monto(res, nLinea, 'BI Gravado DGNG', g('exonerado')),
      valor_adquisicion: monto(res, nLinea, 'Valor Adq. NG', g('valor_adquisicion')),
      otros: monto(res, nLinea, 'Otros Trib/ Cargos', g('otros')),
      total: monto(res, nLinea, 'Total CP', g('total')),
      estado: g('estado') || '1',
      duplicado_en_origen: false,
      lineas_duplicadas: null,
    });
  }

  const per = [...periodos.entries()].sort((a, b) => b[1] - a[1])[0];
  if (per) res.periodoDetectado = per[0];
  const rucEmp = [...rucsEmpresa.entries()].sort((a, b) => b[1] - a[1])[0];
  if (rucEmp) res.rucDetectado = rucEmp[0];
  if (periodos.size > 1) {
    res.advertencias.push(`El archivo SUNAT contiene ${periodos.size} períodos distintos.`);
  }
  if (rucsEmpresa.size > 1) {
    res.advertencias.push(`El archivo SUNAT contiene ${rucsEmpresa.size} RUC de empresa distintos.`);
  }

  return cerrarResultado(res);
}
