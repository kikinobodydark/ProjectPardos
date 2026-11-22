// ============================================================================
// Persistencia del resultado de conciliación de Ventas en la tabla existente
// public.detalle_ventas (sin cambios de esquema). La trazabilidad completa
// (incidencias estructuradas + metadatos) se guarda en errores_json (JSONB).
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

/** Documento conciliado -> fila de detalle_ventas. */
export function aFilaBD(doc, { periodoId, empresaId, ruc }) {
  const fila = {
    periodo_id: periodoId,
    empresa_id: empresaId,
    car_sunat: construirCar(ruc, doc),
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
  const meta = {
    tipo: TIPO.META,
    version: VERSION_FORMATO,
    en_sap: doc.en_sap,
    en_sunat: doc.en_sunat,
    anulado: doc.anulado,
    sap: doc.sap ? { correlativo: doc.sap.correlativo, fecha_emision: doc.sap.fecha_emision, estado: doc.sap.estado, linea: doc.sap.linea } : null,
    sunat: doc.sunat ? { correlativo: doc.sunat.correlativo, fecha_emision: doc.sunat.fecha_emision, estado: doc.sunat.estado, linea: doc.sunat.linea, car_sunat: doc.sunat.car_sunat } : null,
    identidad: doc.identidad,
    cortesia: doc.cortesia,
  };
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

/** Fila de detalle_ventas -> documento conciliado (mismo modelo que produce el motor). */
export function desdeFilaBD(fila) {
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
