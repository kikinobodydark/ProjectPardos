// ============================================================================
// Motor de conciliación de Compras (SAP vs SUNAT — únicamente TXT).
// Empareja por la clave única:
//   RUC DEL PROVEEDOR + CÓDIGO DE TIPO DE DOCUMENTO + SERIE + CORRELATIVO
// ============================================================================
import { validarDocumentoCompras } from './reglas.js';
import { compararCorrelativosCompras, construirClaveLegible } from './documento.js';
import { normalizarDocSap, claveDocSapSinCeros } from './lectores.js';

const datosSistema = (r) => ({
  linea: r.linea ?? null,
  fecha_emision: r.fecha_emision ?? null,
  tipo_doc_pago: r.tipo_doc_pago ?? '',
  tipo_doc_original: r.tipo_doc_original ?? r.tipo_doc_pago ?? '',
  serie: r.serie ?? '',
  correlativo: r.correlativo ?? '',
  tipo_identidad: r.tipo_identidad ?? '',
  nro_identidad: r.nro_identidad ?? '',
  nombre: r.nombre ?? '',
  base: r.base ?? 0,
  igv: r.igv ?? 0,
  exonerado: r.exonerado ?? 0,
  valor_adquisicion: r.valor_adquisicion ?? 0,
  otros: r.otros ?? 0,
  total: r.total ?? 0,
  car_sunat: r.car_sunat ?? null,
  doc_interno: r.doc_interno ? normalizarDocSap(r.doc_interno) : null,
  usuario_sap: r.usuario_sap ?? null,
  transaccion_sap: r.transaccion_sap ?? null,
  fecha_contabilizacion: r.fecha_contabilizacion ?? null,
  texto_cabecera: r.texto_cabecera ?? null,
  duplicado_en_origen: !!r.duplicado_en_origen,
  lineas_duplicadas: r.lineas_duplicadas || null,
});

/**
 * Construye índices rápido (exacto y sin ceros a la izquierda) para cruzar
 * N° de documento SAP contra el Excel opcional de usuarios SAP.
 */
function construirIndiceUsuariosSap(usuariosSap = []) {
  const exacto = new Map();
  const sinCeros = new Map();
  for (const u of usuariosSap || []) {
    const clave = normalizarDocSap(u.doc_sap);
    if (!clave) continue;
    if (!exacto.has(clave)) exacto.set(clave, u);
    const kSin = u.doc_sap_sin_ceros || claveDocSapSinCeros(clave);
    if (kSin && !sinCeros.has(kSin)) sinCeros.set(kSin, u);
  }
  return { exacto, sinCeros };
}

/**
 * Enriquecimiento inmutable de documentos conciliados de Compras con el Excel
 * opcional de Usuarios SAP, cruzando por N° de documento SAP (`doc.sap.doc_interno`).
 * Devuelve los documentos actualizados y estadísticas exactas del cruce.
 */
export function enriquecerComprasConUsuariosSap(docs = [], usuariosSap = []) {
  if (!Array.isArray(usuariosSap) || usuariosSap.length === 0) {
    return {
      docs,
      docsActualizados: [],
      totalCoincidencias: 0,
      totalConDocSap: docs.filter((d) => d.en_sap && d.sap?.doc_interno).length,
      totalExcel: 0,
      sinCoincidenciaExcel: 0,
    };
  }

  const { exacto, sinCeros } = construirIndiceUsuariosSap(usuariosSap);
  const clavesExcelUsadas = new Set();
  const docsActualizados = [];
  let totalConDocSap = 0;

  const nuevosDocs = docs.map((d) => {
    const docSap = d.en_sap ? normalizarDocSap(d.sap?.doc_interno || d.nro_doc_sap) : '';
    if (!docSap) return d;
    totalConDocSap += 1;

    const match = exacto.get(docSap) || sinCeros.get(claveDocSapSinCeros(docSap));
    if (!match) return d;

    clavesExcelUsadas.add(normalizarDocSap(match.doc_sap));
    const usuarioFinal = match.usuario_sap || d.sap?.usuario_sap || null;
    const transaccionFinal = match.transaccion_sap || d.sap?.transaccion_sap || null;
    const fechaContabFinal = match.fecha_contabilizacion || d.sap?.fecha_contabilizacion || null;
    const textoCabFinal = match.texto_cabecera || d.sap?.texto_cabecera || null;

    const actualizado = {
      ...d,
      nro_doc_sap: docSap,
      usuario_sap: usuarioFinal || '',
      sap: {
        ...d.sap,
        doc_interno: docSap,
        usuario_sap: usuarioFinal,
        transaccion_sap: transaccionFinal,
        fecha_contabilizacion: fechaContabFinal,
        texto_cabecera: textoCabFinal,
      },
    };
    docsActualizados.push(actualizado);
    return actualizado;
  });

  return {
    docs: nuevosDocs,
    docsActualizados,
    totalCoincidencias: docsActualizados.length,
    totalConDocSap,
    totalExcel: exacto.size,
    sinCoincidenciaExcel: Math.max(0, exacto.size - clavesExcelUsadas.size),
  };
}

/**
 * Concilia los registros normalizados de SAP y SUNAT del módulo de Compras,
 * y opcionalmente enriquece con el archivo Excel de Usuarios SAP.
 * @param {{ sap: object[], sunat: object[], usuariosSap?: object[] | null }} entrada
 * @returns {{ docs: object[] }}
 */
export function conciliarCompras({ sap = [], sunat = [], usuariosSap = null }) {
  const mapa = new Map();

  const obtener = (r) => {
    let d = mapa.get(r.clave);
    if (!d) {
      d = {
        key: r.clave,
        clave_legible: r.clave_legible || construirClaveLegible(r.nro_identidad, r.tipo_doc_pago, r.serie, r.correlativo),
        ruc_proveedor: r.nro_identidad || '',
        razon_social: r.nombre || '',
        tipo_doc_pago: r.tipo_doc_pago || '',
        serie: r.serie || '',
        correlativo: r.correlativo || '',
        fecha_emision: r.fecha_emision || null,
        nro_doc_sap: '',
        usuario_sap: '',
        sap: null,
        sunat: null,
        en_sap: false,
        en_sunat: false,
        incidencias: [],
        codigos: [],
        codigosError: [],
        codigosObs: [],
        resultado: 'OK',
        estado: 'OK',
      };
      mapa.set(r.clave, d);
    }
    return d;
  };

  // 1. Cargar SUNAT
  for (const r of sunat) {
    const d = obtener(r);
    d.sunat = datosSistema(r);
    d.en_sunat = true;
    if (r.nro_identidad) d.ruc_proveedor = r.nro_identidad;
    if (r.nombre) d.razon_social = r.nombre;
    if (r.correlativo) d.correlativo = r.correlativo;
    if (r.fecha_emision) d.fecha_emision = r.fecha_emision;
  }

  // 2. Cruzar con SAP por la misma clave única
  for (const r of sap) {
    const d = obtener(r);
    d.sap = datosSistema(r);
    d.en_sap = true;
    d.nro_doc_sap = d.sap.doc_interno || '';
    d.usuario_sap = d.sap.usuario_sap || '';
    if (!d.ruc_proveedor && r.nro_identidad) d.ruc_proveedor = r.nro_identidad;
    if (!d.razon_social && r.nombre) d.razon_social = r.nombre;
    if (!d.fecha_emision && r.fecha_emision) d.fecha_emision = r.fecha_emision;
    // Preservar representación con ceros a la izquierda si SAP tiene mayor longitud (ej. 00001234 vs 1234)
    if (r.correlativo && (!d.correlativo || r.correlativo.length > d.correlativo.length)) {
      d.correlativo = r.correlativo;
    }
    d.clave_legible = construirClaveLegible(d.ruc_proveedor, d.tipo_doc_pago, d.serie, d.correlativo);
  }

  let docs = [...mapa.values()];

  // 2.5 Cruzar opcionalmente con el Excel de Usuarios SAP por N° de documento SAP
  if (Array.isArray(usuariosSap) && usuariosSap.length > 0) {
    docs = enriquecerComprasConUsuariosSap(docs, usuariosSap).docs;
  }

  // 3. Ejecutar todas las validaciones de errores (1..8) y observaciones (1..3)
  for (const d of docs) {
    const val = validarDocumentoCompras(d);
    d.incidencias = val.incidencias;
    d.resultado = val.resultado;
    d.estado = val.estado;
    d.codigos = val.codigos;
    d.codigosError = val.codigosError;
    d.codigosObs = val.codigosObs;
  }

  // 4. Orden estable: fecha de emisión, RUC, tipo, serie, correlativo
  docs.sort((a, b) =>
    (a.fecha_emision || a.sap?.fecha_emision || a.sunat?.fecha_emision || '').localeCompare(
      b.fecha_emision || b.sap?.fecha_emision || b.sunat?.fecha_emision || ''
    ) ||
    (a.ruc_proveedor || '').localeCompare(b.ruc_proveedor || '') ||
    (a.tipo_doc_pago || '').localeCompare(b.tipo_doc_pago || '') ||
    (a.serie || '').localeCompare(b.serie || '') ||
    compararCorrelativosCompras(a.correlativo, b.correlativo)
  );

  return { docs };
}
