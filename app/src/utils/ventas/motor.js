// ============================================================================
// Motor de conciliación SAP vs SUNAT (módulo de Ventas).
// Orquesta las reglas independientes de ./reglas.js. Se ejecuta UNA sola vez
// por proceso de validación; la presentación trabaja sobre su resultado.
// ============================================================================
import { TIPO } from './catalogos.js';
import {
  validarIdentidad, validarImportes, validarCortesia, validarSecuencias, estadoGeneral, crearIncidencia,
} from './reglas.js';

const datosSistema = (r) => ({
  linea: r.linea,
  correlativo: r.correlativo,
  fecha_emision: r.fecha_emision,
  tipo_identidad: r.tipo_identidad,
  nro_identidad: r.nro_identidad,
  nombre: r.nombre,
  base: r.base,
  igv: r.igv,
  exonerado: r.exonerado,
  inafecto: r.inafecto,
  otros: r.otros,
  total: r.total,
  op_gratuitas: r.op_gratuitas || 0,
  estado: r.estado,
  car_sunat: r.car_sunat || null,
});

/**
 * @param {{ sap: object[], sunat: object[], cortesias?: object[]|null }} entrada
 *        registros únicos devueltos por los lectores (lectores.js)
 * @returns {{ docs: object[], series: object[], cortesiasNoEncontradas: object[] }}
 */
export function conciliarVentas({ sap, sunat, cortesias = null }) {
  const mapa = new Map();

  const obtener = (r) => {
    let d = mapa.get(r.clave);
    if (!d) {
      d = {
        key: r.clave, tipo_doc_pago: r.tipo_doc_pago, serie: r.serie,
        correlativo: r.correlativo, fecha_emision: r.fecha_emision,
        sap: null, sunat: null, incidencias: [],
      };
      mapa.set(r.clave, d);
    }
    return d;
  };

  // R-DOC-01: emparejamiento por tipo + serie + correlativo
  for (const r of sunat) {
    const d = obtener(r);
    d.sunat = datosSistema(r);
    d.correlativo = r.correlativo; // se prioriza la representación SUNAT
    d.fecha_emision = r.fecha_emision || d.fecha_emision;
  }
  for (const r of sap) {
    const d = obtener(r);
    d.sap = datosSistema(r);
    if (!d.fecha_emision) d.fecha_emision = r.fecha_emision;
  }

  const cortesiasPorClave = cortesias ? new Map(cortesias.map((c) => [c.clave, c])) : null;
  const docs = [...mapa.values()];

  for (const d of docs) {
    d.en_sap = !!d.sap;
    d.en_sunat = !!d.sunat;
    d.anulado = d.sap?.estado === '2' || d.sunat?.estado === '2';

    // 4.2 / 4.3 Existencia
    if (!d.en_sap) d.incidencias.push(crearIncidencia('OBS 4', 'R-EXI-01', 'El comprobante figura en SUNAT pero no en SAP'));
    if (!d.en_sunat) d.incidencias.push(crearIncidencia('OBS 5', 'R-EXI-02', 'El comprobante figura en SAP pero no en SUNAT'));

    // 5. Identidad (no aplica a comprobantes anulados)
    if (d.anulado) {
      d.identidad = null;
      d.incidencias.push({
        codigo: 'ANULADO', tipo: TIPO.INFO, descripcion: 'COMPROBANTE ANULADO',
        detalle: `Estado SAP: ${d.sap?.estado ?? '—'} · Estado SUNAT: ${d.sunat?.estado ?? '—'}. No se evalúan reglas de identidad.`,
        regla: 'R-ANU-01', datos: {},
      });
    } else {
      const id = validarIdentidad(d);
      d.identidad = id.identidad;
      d.incidencias.push(...id.incidencias);
    }

    // 6. Importes
    d.incidencias.push(...validarImportes(d).incidencias);

    // 7. Cortesías
    const exc = cortesiasPorClave ? cortesiasPorClave.get(d.key) || null : null;
    d.cortesia = validarCortesia(d, exc, !!cortesiasPorClave);
  }

  // 4.4 Secuencias (requiere el universo completo)
  const series = validarSecuencias(docs);

  // 8. Estado general (ERROR > OBSERVADO > OK), sin sobrescribir incidencias
  for (const d of docs) {
    d.estado = estadoGeneral(d.incidencias);
    d.codigos = [...new Set(d.incidencias.filter((i) => i.tipo !== TIPO.INFO).map((i) => i.codigo))];
  }

  const cortesiasNoEncontradas = cortesias ? cortesias.filter((c) => !mapa.has(c.clave)) : [];

  docs.sort((a, b) => {
    const fa = a.fecha_emision || '';
    const fb = b.fecha_emision || '';
    if (fa !== fb) return fa < fb ? -1 : 1;
    if (a.serie !== b.serie) return a.serie < b.serie ? -1 : 1;
    if (a.correlativo.length !== b.correlativo.length) return a.correlativo.length - b.correlativo.length;
    return a.correlativo < b.correlativo ? -1 : a.correlativo > b.correlativo ? 1 : 0;
  });

  return { docs, series, cortesiasNoEncontradas };
}
