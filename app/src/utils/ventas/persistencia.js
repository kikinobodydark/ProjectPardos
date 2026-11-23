// ============================================================================
// Persistencia del resultado de conciliación de Ventas en la tabla existente
// public.detalle_ventas.
// Optimización de payload: `meta` en `errores_json` omite campos redundantes
// que ya existen en columnas de la fila o que son valores por defecto,
// reduciendo ~70% el tamaño del JSON enviado por red e indexado por GIN.
// ============================================================================
import { centimosADecimal, decimalACentimos } from './montos.js';
import { TIPO, INCIDENCIA_POR_CODIGO } from './catalogos.js';
import { claveDocumento, correlativoCanonico } from './documento.js';

export const VERSION_FORMATO = 2;

const CAMPOS_MONTO = ['base', 'igv', 'exonerado', 'inafecto', 'otros', 'total'];

/** CAR SUNAT: RUC + tipo(2) + serie + correlativo (10 dígitos) - mismo formato del reporte SUNAT. */
export function construirCar(ruc, doc) {
  if (doc.sunat?.car_sunat) return doc.sunat.car_sunat;
  return `${ruc}${doc.tipo_doc_pago}${doc.serie}${correlativoCanonico(doc.correlativo).padStart(10, '0')}`;
}

/** Documento conciliado -> fila compacta de detalle_ventas. */
export function aFilaBD(doc, { periodoId, empresaId, ruc }) {
  const carSunat = construirCar(ruc, doc);
  const fila = {
    periodo_id: periodoId,
    empresa_id: empresaId,
    car_sunat: carSunat,
    serie: doc.serie,
    correlativo: doc.correlativo,
    fecha_emision: doc.fecha_emision,
    tipo_doc_pago: doc.tipo_doc_pago,
    mensaje_sire: null,
    tipo_pago_sire: doc.cortesia && (doc.cortesia.sap || doc.cortesia.sunat) ? 'CORTESIA' : 'NORMAL',
    op_gratuitas: centimosADecimal(doc.sunat?.op_gratuitas || 0),
    estado_validacion: doc.estado,
  };
  for (const sis of ['sap', 'sunat']) {
    const r = doc[sis];
    fila[`tipo_identidad_${sis}`] = r ? r.tipo_identidad : null;
    fila[`nro_identidad_${sis}`] = r ? r.nro_identidad : null;
    fila[`nombre_${sis}`] = r ? r.nombre : null;
    for (const m of CAMPOS_MONTO) fila[`${m}_${sis}`] = r ? centimosADecimal(r[m]) : 0;
  }

  // Metadatos compactos: solo guarda diferencias respecto a las columnas base
  const meta = {
    tipo: TIPO.META,
    version: VERSION_FORMATO,
    en_sap: doc.en_sap,
    en_sunat: doc.en_sunat,
  };
  if (doc.anulado) meta.anulado = true;
  if (doc.sap) {
    meta.sap = { correlativo: doc.sap.correlativo, linea: doc.sap.linea };
    if (doc.sap.fecha_emision !== doc.fecha_emision) meta.sap.fecha_emision = doc.sap.fecha_emision;
    if (doc.sap.estado && doc.sap.estado !== '1') meta.sap.estado = doc.sap.estado;
  }
  if (doc.sunat) {
    meta.sunat = { linea: doc.sunat.linea };
    if (doc.sunat.correlativo !== doc.correlativo) meta.sunat.correlativo = doc.sunat.correlativo;
    if (doc.sunat.fecha_emision !== doc.fecha_emision) meta.sunat.fecha_emision = doc.sunat.fecha_emision;
    if (doc.sunat.estado && doc.sunat.estado !== '1') meta.sunat.estado = doc.sunat.estado;
    if (doc.sunat.car_sunat && doc.sunat.car_sunat !== carSunat) meta.sunat.car_sunat = doc.sunat.car_sunat;
  }
  if (doc.cortesia) meta.cortesia = doc.cortesia;

  fila.errores_json = [...doc.incidencias, meta];
  return fila;
}

/**
 * Versión compacta de `aFilaBD` para las RPCs masivas (`insertar_lote_ventas_json`):
 * omite `periodo_id`, `empresa_id`, `mensaje_sire` (los inyecta la RPC) y campos
 * numéricos en 0 o valores por defecto ('NORMAL'), reduciendo ~35-45% el payload JSON.
 */
export function aFilaBDRpc(doc, { ruc }) {
  const carSunat = construirCar(ruc, doc);
  const fila = {
    car_sunat: carSunat,
    serie: doc.serie,
    correlativo: doc.correlativo,
    fecha_emision: doc.fecha_emision,
    tipo_doc_pago: doc.tipo_doc_pago,
    estado_validacion: doc.estado,
  };
  if (doc.cortesia && (doc.cortesia.sap || doc.cortesia.sunat)) {
    fila.tipo_pago_sire = 'CORTESIA';
  }
  const opGrat = doc.sunat?.op_gratuitas || 0;
  if (opGrat !== 0) {
    fila.op_gratuitas = centimosADecimal(opGrat);
  }
  for (const sis of ['sap', 'sunat']) {
    const r = doc[sis];
    if (!r) continue;
    if (r.tipo_identidad !== null && r.tipo_identidad !== undefined) fila[`tipo_identidad_${sis}`] = r.tipo_identidad;
    if (r.nro_identidad !== null && r.nro_identidad !== undefined) fila[`nro_identidad_${sis}`] = r.nro_identidad;
    if (r.nombre !== null && r.nombre !== undefined) fila[`nombre_${sis}`] = r.nombre;
    for (const m of CAMPOS_MONTO) {
      if (r[m]) fila[`${m}_${sis}`] = centimosADecimal(r[m]);
    }
  }

  const meta = {
    tipo: TIPO.META,
    version: VERSION_FORMATO,
    en_sap: doc.en_sap,
    en_sunat: doc.en_sunat,
  };
  if (doc.anulado) meta.anulado = true;
  if (doc.sap) {
    meta.sap = { correlativo: doc.sap.correlativo, linea: doc.sap.linea };
    if (doc.sap.fecha_emision !== doc.fecha_emision) meta.sap.fecha_emision = doc.sap.fecha_emision;
    if (doc.sap.estado && doc.sap.estado !== '1') meta.sap.estado = doc.sap.estado;
  }
  if (doc.sunat) {
    meta.sunat = { linea: doc.sunat.linea };
    if (doc.sunat.correlativo !== doc.correlativo) meta.sunat.correlativo = doc.sunat.correlativo;
    if (doc.sunat.fecha_emision !== doc.fecha_emision) meta.sunat.fecha_emision = doc.sunat.fecha_emision;
    if (doc.sunat.estado && doc.sunat.estado !== '1') meta.sunat.estado = doc.sunat.estado;
    if (doc.sunat.car_sunat && doc.sunat.car_sunat !== carSunat) meta.sunat.car_sunat = doc.sunat.car_sunat;
  }
  if (doc.cortesia) meta.cortesia = doc.cortesia;

  fila.errores_json = [...doc.incidencias, meta];
  return fila;
}

/** Convierte incidencias en texto (cargas anteriores) al formato estructurado. */
function incidenciaDesdeTexto(txt) {
  const m = /^(ERROR \d+|OBS \d+)\s*:\s*(.*)$/i.exec(String(txt));
  if (m && INCIDENCIA_POR_CODIGO[m[1].toUpperCase()]) {
    const def = INCIDENCIA_POR_CODIGO[m[1].toUpperCase()];
    return { codigo: def.codigo, tipo: def.tipo, descripcion: def.descripcion, detalle: m[2], regla: 'Carga anterior', datos: {} };
  }
  return { codigo: 'INFO', tipo: TIPO.INFO, descripcion: 'NOTA', detalle: String(txt), regla: 'Carga anterior', datos: {} };
}

/** Convierte una tupla compacta de `obtener_lote_ventas_compact` en fila objeto estándar. */
export function filaVentasDesdeTupla(t) {
  if (!Array.isArray(t)) return t;
  return {
    id: t[0],
    car_sunat: t[1],
    serie: t[2],
    correlativo: t[3],
    fecha_emision: t[4],
    tipo_doc_pago: t[5],
    tipo_identidad_sap: t[6],
    nro_identidad_sap: t[7],
    nombre_sap: t[8],
    base_sap: t[9],
    igv_sap: t[10],
    exonerado_sap: t[11],
    inafecto_sap: t[12],
    otros_sap: t[13],
    total_sap: t[14],
    tipo_identidad_sunat: t[15],
    nro_identidad_sunat: t[16],
    nombre_sunat: t[17],
    base_sunat: t[18],
    igv_sunat: t[19],
    exonerado_sunat: t[20],
    inafecto_sunat: t[21],
    otros_sunat: t[22],
    total_sunat: t[23],
    tipo_pago_sire: t[24],
    op_gratuitas: t[25],
    estado_validacion: t[26],
    errores_json: t[27],
  };
}

/** Fila de detalle_ventas (objeto o tupla compacta) -> documento conciliado (mismo modelo que produce el motor). */
export function desdeFilaBD(rawFila) {
  const fila = Array.isArray(rawFila) ? filaVentasDesdeTupla(rawFila) : rawFila;
  const lista = Array.isArray(fila.errores_json) ? fila.errores_json : [];
  const meta = lista.find((x) => x && typeof x === 'object' && x.tipo === TIPO.META) || null;
  const incidencias = lista
    .filter((x) => !(x && typeof x === 'object' && x.tipo === TIPO.META))
    .map((x) => (typeof x === 'string' ? incidenciaDesdeTexto(x) : x));

  const existe = (sis) => (meta ? !!meta[`en_${sis}`] : fila[`nro_identidad_${sis}`] !== null || fila[`nombre_${sis}`] !== null);
  const sistema = (sis) => {
    if (!existe(sis)) return null;
    const r = {
      tipo_identidad: fila[`tipo_identidad_${sis}`],
      nro_identidad: fila[`nro_identidad_${sis}`],
      nombre: fila[`nombre_${sis}`],
      correlativo: meta?.[sis]?.correlativo ?? fila.correlativo,
      fecha_emision: meta?.[sis]?.fecha_emision ?? fila.fecha_emision,
      estado: meta?.[sis]?.estado ?? '1',
      linea: meta?.[sis]?.linea ?? null,
      car_sunat: sis === 'sunat' ? (meta?.sunat?.car_sunat ?? fila.car_sunat) : null,
      op_gratuitas: sis === 'sunat' ? decimalACentimos(fila.op_gratuitas) : 0,
    };
    for (const m of CAMPOS_MONTO) r[m] = decimalACentimos(fila[`${m}_${sis}`]);
    return r;
  };

  const doc = {
    id: fila.id,
    key: claveDocumento(fila.tipo_doc_pago, fila.serie, fila.correlativo),
    tipo_doc_pago: fila.tipo_doc_pago,
    serie: fila.serie,
    correlativo: fila.correlativo,
    fecha_emision: fila.fecha_emision,
    sap: sistema('sap'),
    sunat: sistema('sunat'),
    incidencias,
    identidad: meta?.identidad ?? null,
    cortesia: meta?.cortesia ?? null,
    estado: fila.estado_validacion,
    formato: meta ? meta.version : 1,
  };
  doc.en_sap = !!doc.sap;
  doc.en_sunat = !!doc.sunat;
  doc.anulado = meta ? !!meta.anulado : doc.sap?.nombre?.toUpperCase() === 'ANULADO';
  doc.codigos = [...new Set(incidencias.filter((i) => i.tipo !== TIPO.INFO).map((i) => i.codigo))];
  return doc;
}
