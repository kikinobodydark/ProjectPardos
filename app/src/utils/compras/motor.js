// ============================================================================
// Motor de conciliación de Compras (SAP vs SUNAT — únicamente TXT).
// Empareja por la clave única:
//   RUC DEL PROVEEDOR + CÓDIGO DE TIPO DE DOCUMENTO + SERIE + CORRELATIVO
// ============================================================================
import { validarDocumentoCompras } from './reglas.js';
import { compararCorrelativosCompras, construirClaveLegible } from './documento.js';

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
  doc_interno: r.doc_interno ?? null,
  duplicado_en_origen: !!r.duplicado_en_origen,
  lineas_duplicadas: r.lineas_duplicadas || null,
});

/**
 * Concilia los registros normalizados de SAP y SUNAT del módulo de Compras.
 * @param {{ sap: object[], sunat: object[] }} entrada
 * @returns {{ docs: object[] }}
 */
export function conciliarCompras({ sap = [], sunat = [] }) {
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
    if (!d.ruc_proveedor && r.nro_identidad) d.ruc_proveedor = r.nro_identidad;
    if (!d.razon_social && r.nombre) d.razon_social = r.nombre;
    if (!d.fecha_emision && r.fecha_emision) d.fecha_emision = r.fecha_emision;
    // Preservar representación con ceros a la izquierda si SAP tiene mayor longitud (ej. 00001234 vs 1234)
    if (r.correlativo && (!d.correlativo || r.correlativo.length > d.correlativo.length)) {
      d.correlativo = r.correlativo;
    }
    d.clave_legible = construirClaveLegible(d.ruc_proveedor, d.tipo_doc_pago, d.serie, d.correlativo);
  }

  const docs = [...mapa.values()];

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
