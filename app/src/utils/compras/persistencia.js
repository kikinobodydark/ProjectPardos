// ============================================================================
// Persistencia del resultado de conciliación de Compras en public.detalle_compras.
//  - Mantiene compatibilidad total con columnas, constraints VARCHAR y vistas SQL.
//  - Persiste Valor de Adquisición en `inafecto_sap` / `inafecto_sunat`.
//  - Persiste metadata compacta (`META`) en `errores_json` para preservar fechas
//    separadas SAP/SUNAT, clasificación de 5 estados, clave única, ceros a la
//    izquierda y trazabilidad de línea de origen.
// ============================================================================
import { centimosADecimal, decimalACentimos } from '../ventas/montos.js';
import {
  TIPO,
  INCIDENCIA_COMPRAS_POR_CODIGO,
  RESULTADOS_COMPRAS,
} from './catalogos.js';
import {
  construirCarBDCompras,
  construirClaveCompras,
  construirClaveLegible,
  normalizarTipoDocCompras,
} from './documento.js';
import { clasificarDocumentoCompras } from './reglas.js';

export const VERSION_FORMATO_COMPRAS = 2;

/** Documento conciliado de Compras -> fila lista para insertar en detalle_compras. */
export function aFilaBDCompras(doc, { periodoId, empresaId }) {
  const carBD = construirCarBDCompras(doc.ruc_proveedor, doc.tipo_doc_pago, doc.serie, doc.correlativo);

  const fila = {
    periodo_id: periodoId,
    empresa_id: empresaId,
    car_sunat: carBD,
    ruc_proveedor: doc.ruc_proveedor ? String(doc.ruc_proveedor).slice(0, 11) : null,
    serie: String(doc.serie || '').slice(0, 10) || '-',
    correlativo: String(doc.correlativo || '').slice(0, 20) || '0',
    fecha_emision: doc.fecha_emision || doc.sunat?.fecha_emision || doc.sap?.fecha_emision || null,
    tipo_doc_pago: String(normalizarTipoDocCompras(doc.tipo_doc_pago) || '00').slice(0, 2),
    mensaje_sire: null,
    estado_validacion: doc.estado || 'OK',

    // SAP
    tipo_identidad_sap: doc.sap ? (String(doc.sap.tipo_identidad || '').slice(0, 2) || null) : null,
    nro_identidad_sap: doc.sap ? (String(doc.sap.nro_identidad || '').slice(0, 20) || null) : null,
    nombre_sap: doc.sap ? (doc.sap.nombre || null) : null,
    base_sap: doc.sap ? centimosADecimal(doc.sap.base) : 0,
    igv_sap: doc.sap ? centimosADecimal(doc.sap.igv) : 0,
    exonerado_sap: doc.sap ? centimosADecimal(doc.sap.exonerado) : 0,
    inafecto_sap: doc.sap ? centimosADecimal(doc.sap.valor_adquisicion) : 0,
    otros_sap: doc.sap ? centimosADecimal(doc.sap.otros) : 0,
    total_sap: doc.sap ? centimosADecimal(doc.sap.total) : 0,

    // SUNAT
    tipo_identidad_sunat: doc.sunat ? (String(doc.sunat.tipo_identidad || '').slice(0, 2) || null) : null,
    nro_identidad_sunat: doc.sunat ? (String(doc.sunat.nro_identidad || '').slice(0, 20) || null) : null,
    nombre_sunat: doc.sunat ? (doc.sunat.nombre || null) : null,
    base_sunat: doc.sunat ? centimosADecimal(doc.sunat.base) : 0,
    igv_sunat: doc.sunat ? centimosADecimal(doc.sunat.igv) : 0,
    exonerado_sunat: doc.sunat ? centimosADecimal(doc.sunat.exonerado) : 0,
    inafecto_sunat: doc.sunat ? centimosADecimal(doc.sunat.valor_adquisicion) : 0,
    otros_sunat: doc.sunat ? centimosADecimal(doc.sunat.otros) : 0,
    total_sunat: doc.sunat ? centimosADecimal(doc.sunat.total) : 0,
  };

  const meta = {
    tipo: TIPO.META,
    version: VERSION_FORMATO_COMPRAS,
    en_sap: !!doc.en_sap,
    en_sunat: !!doc.en_sunat,
    resultado: doc.resultado,
    clave_legible: doc.clave_legible,
  };

  if (doc.ruc_proveedor && doc.ruc_proveedor.length > 11) {
    meta.ruc_proveedor = doc.ruc_proveedor;
  }
  if (doc.serie && doc.serie.length > 10) meta.serie = doc.serie;
  if (doc.correlativo && doc.correlativo.length > 20) meta.correlativo = doc.correlativo;
  if (doc.tipo_doc_pago && doc.tipo_doc_pago.length > 2) meta.tipo_doc_pago = doc.tipo_doc_pago;

  if (doc.sap) {
    meta.sap = {
      linea: doc.sap.linea ?? null,
      fecha_emision: doc.sap.fecha_emision ?? null,
    };
    if (doc.sap.doc_interno) meta.sap.doc_interno = doc.sap.doc_interno;
    if (doc.sap.usuario_sap) meta.sap.usuario_sap = doc.sap.usuario_sap;
    if (doc.sap.transaccion_sap) meta.sap.transaccion_sap = doc.sap.transaccion_sap;
    if (doc.sap.fecha_contabilizacion) meta.sap.fecha_contabilizacion = doc.sap.fecha_contabilizacion;
    if (doc.sap.texto_cabecera) meta.sap.texto_cabecera = doc.sap.texto_cabecera;
    if (doc.sap.correlativo && doc.sap.correlativo !== fila.correlativo) meta.sap.correlativo = doc.sap.correlativo;
    if (doc.sap.serie && doc.sap.serie !== fila.serie) meta.sap.serie = doc.sap.serie;
    if (doc.sap.tipo_doc_pago && doc.sap.tipo_doc_pago !== fila.tipo_doc_pago) meta.sap.tipo_doc_pago = doc.sap.tipo_doc_pago;
    if (doc.sap.tipo_doc_original && doc.sap.tipo_doc_original !== doc.sap.tipo_doc_pago) meta.sap.tipo_doc_original = doc.sap.tipo_doc_original;
    if (doc.sap.duplicado_en_origen) {
      meta.sap.duplicado_en_origen = true;
      meta.sap.lineas_duplicadas = doc.sap.lineas_duplicadas;
    }
  }

  if (doc.sunat) {
    meta.sunat = {
      linea: doc.sunat.linea ?? null,
      fecha_emision: doc.sunat.fecha_emision ?? null,
    };
    if (doc.sunat.correlativo && doc.sunat.correlativo !== fila.correlativo) meta.sunat.correlativo = doc.sunat.correlativo;
    if (doc.sunat.serie && doc.sunat.serie !== fila.serie) meta.sunat.serie = doc.sunat.serie;
    if (doc.sunat.tipo_doc_pago && doc.sunat.tipo_doc_pago !== fila.tipo_doc_pago) meta.sunat.tipo_doc_pago = doc.sunat.tipo_doc_pago;
    if (doc.sunat.tipo_doc_original && doc.sunat.tipo_doc_original !== doc.sunat.tipo_doc_pago) meta.sunat.tipo_doc_original = doc.sunat.tipo_doc_original;
    if (doc.sunat.car_sunat && doc.sunat.car_sunat !== carBD) meta.sunat.car_sunat = doc.sunat.car_sunat;
    if (doc.sunat.duplicado_en_origen) {
      meta.sunat.duplicado_en_origen = true;
      meta.sunat.lineas_duplicadas = doc.sunat.lineas_duplicadas;
    }
  }

  fila.errores_json = [...(doc.incidencias || []), meta];
  return fila;
}

/**
 * Versión compacta de `aFilaBDCompras` para las RPCs masivas (`insertar_lote_compras_json`):
 * omite `periodo_id`, `empresa_id`, `mensaje_sire` y montos en 0 para reducir el payload en red.
 */
export function aFilaBDComprasRpc(doc) {
  const full = aFilaBDCompras(doc, { periodoId: undefined, empresaId: undefined });
  const compact = {};
  for (const [k, v] of Object.entries(full)) {
    if (k === 'periodo_id' || k === 'empresa_id' || k === 'mensaje_sire') continue;
    if (v === null || v === undefined || v === 0) continue;
    compact[k] = v;
  }
  return compact;
}

/** Convierte incidencias de texto plano (cargas antiguas) al formato estructurado. */
function incidenciaLegacyDesdeTexto(txt) {
  const m = /^(ERROR \d+|OBS \d+)\s*:\s*(.*)$/i.exec(String(txt));
  if (m) {
    const cod = m[1].toUpperCase();
    const def = INCIDENCIA_COMPRAS_POR_CODIGO[cod];
    if (def) {
      return {
        codigo: def.codigo,
        tipo: def.tipo,
        descripcion: def.descripcion,
        detalle: m[2] || def.descripcion,
        regla: 'Carga anterior',
        datos: {},
      };
    }
  }
  return {
    codigo: 'INFO',
    tipo: TIPO.INFO,
    descripcion: 'NOTA',
    detalle: String(txt),
    regla: 'Carga anterior',
    datos: {},
  };
}

/** Fila de public.detalle_compras -> documento conciliado del modelo de Compras. */
export function desdeFilaBDCompras(fila) {
  const lista = Array.isArray(fila.errores_json) ? fila.errores_json : [];
  const meta = lista.find((x) => x && typeof x === 'object' && x.tipo === TIPO.META) || null;
  const incidencias = lista
    .filter((x) => !(x && typeof x === 'object' && x.tipo === TIPO.META))
    .map((x) => (typeof x === 'string' ? incidenciaLegacyDesdeTexto(x) : x));

  const existe = (sis) =>
    meta
      ? !!meta[`en_${sis}`]
      : fila[`nro_identidad_${sis}`] !== null || fila[`nombre_${sis}`] !== null;

  const serie = meta?.serie ?? fila.serie;
  const correlativo = meta?.correlativo ?? fila.correlativo;
  const tipoDoc = meta?.tipo_doc_pago ?? fila.tipo_doc_pago;

  const construirSistema = (sis) => {
    if (!existe(sis)) return null;
    const m = meta?.[sis] || {};
    return {
      linea: m.linea ?? null,
      fecha_emision: m.fecha_emision !== undefined ? m.fecha_emision : fila.fecha_emision,
      tipo_doc_pago: m.tipo_doc_pago ?? tipoDoc,
      tipo_doc_original: m.tipo_doc_original ?? m.tipo_doc_pago ?? tipoDoc,
      serie: m.serie ?? serie,
      correlativo: m.correlativo ?? correlativo,
      tipo_identidad: fila[`tipo_identidad_${sis}`] ?? '',
      nro_identidad: fila[`nro_identidad_${sis}`] ?? '',
      nombre: fila[`nombre_${sis}`] ?? '',
      base: decimalACentimos(fila[`base_${sis}`]),
      igv: decimalACentimos(fila[`igv_${sis}`]),
      exonerado: decimalACentimos(fila[`exonerado_${sis}`]),
      valor_adquisicion: decimalACentimos(fila[`inafecto_${sis}`]),
      otros: decimalACentimos(fila[`otros_${sis}`]),
      total: decimalACentimos(fila[`total_${sis}`]),
      car_sunat: sis === 'sunat' ? (m.car_sunat ?? fila.car_sunat) : null,
      doc_interno: sis === 'sap' ? (m.doc_interno ?? null) : null,
      usuario_sap: sis === 'sap' ? (m.usuario_sap ?? null) : null,
      transaccion_sap: sis === 'sap' ? (m.transaccion_sap ?? null) : null,
      fecha_contabilizacion: sis === 'sap' ? (m.fecha_contabilizacion ?? null) : null,
      texto_cabecera: sis === 'sap' ? (m.texto_cabecera ?? null) : null,
      duplicado_en_origen: !!m.duplicado_en_origen,
      lineas_duplicadas: m.lineas_duplicadas || null,
    };
  };

  const sap = construirSistema('sap');
  const sunat = construirSistema('sunat');
  const rucProveedor =
    meta?.ruc_proveedor ||
    fila.nro_identidad_sunat ||
    fila.nro_identidad_sap ||
    fila.ruc_proveedor ||
    '';

  const doc = {
    id: fila.id,
    key: construirClaveCompras(rucProveedor, tipoDoc, serie, correlativo),
    clave_legible: meta?.clave_legible || construirClaveLegible(rucProveedor, tipoDoc, serie, correlativo),
    ruc_proveedor: rucProveedor,
    razon_social: sunat?.nombre || sap?.nombre || '',
    tipo_doc_pago: tipoDoc,
    serie,
    correlativo,
    fecha_emision: fila.fecha_emision,
    nro_doc_sap: sap?.doc_interno || '',
    usuario_sap: sap?.usuario_sap || '',
    sap,
    sunat,
    en_sap: !!sap,
    en_sunat: !!sunat,
    incidencias,
    formato: meta ? meta.version : 1,
  };

  const errores = incidencias.filter((i) => i.tipo === TIPO.ERROR);
  const observaciones = incidencias.filter((i) => i.tipo === TIPO.OBS);
  doc.codigosError = [...new Set(errores.map((i) => i.codigo))];
  doc.codigosObs = [...new Set(observaciones.map((i) => i.codigo))];
  doc.codigos = [...doc.codigosError, ...doc.codigosObs];

  if (meta?.resultado && RESULTADOS_COMPRAS[meta.resultado]) {
    doc.resultado = meta.resultado;
    doc.estado = fila.estado_validacion || RESULTADOS_COMPRAS[meta.resultado].estadoBD;
  } else {
    const clas = clasificarDocumentoCompras(doc, incidencias);
    doc.resultado = clas.resultado;
    doc.estado = fila.estado_validacion || clas.estado;
  }

  return doc;
}
