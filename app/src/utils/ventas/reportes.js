// ============================================================================
// Filtros, indicadores generales, 12 reportes específicos y exportación Excel
// para el módulo de Ventas. Opera sobre los documentos ya conciliados en
// memoria para evitar re-ejecutar validaciones al cambiar filtros visuales.
// ============================================================================
import * as XLSX from 'xlsx';
import {
  INCIDENCIAS, CODIGOS_IMPORTES, CODIGOS_IDENTIDAD, ESTADOS,
  descripcionTipoCP, descripcionTipoIdentidad,
} from './catalogos.js';
import { centimosADecimal, dentroDeTolerancia } from './montos.js';
import { validarImportes, evaluarIdentidad, sistemaCorrecto } from './reglas.js';
import { compararCorrelativos, diferenciaCorrelativos } from './documento.js';

export const FILTROS_INICIALES = {
  busqueda: '',
  estado: 'ALL',         // ALL | OK | OBSERVADO | ERROR
  tipoCP: 'ALL',         // ALL | 01 | 03 | 07 | 08
  existencia: 'ALL',     // ALL | AMBOS | SAP | SUNAT | SOLO_SAP | SOLO_SUNAT
  categoria: 'ALL',      // ALL | DIF_IMPORTES | PROB_IDENTIDAD | CORTESIAS
  codigos: [],           // multi-selección: ['ERROR 1', 'OBS 2', ...]
  serie: '',
  corrDesde: '',
  corrHasta: '',
  fechaDesde: '',
  fechaHasta: '',
};

/** Aplica todos los filtros visuales sobre la lista de documentos conciliados. */
export function filtrarDocumentos(docs, f = FILTROS_INICIALES) {
  const q = (f.busqueda || '').trim().toLowerCase();
  const serieQ = (f.serie || '').trim().toUpperCase();
  const cDesde = (f.corrDesde || '').trim();
  const cHasta = (f.corrHasta || '').trim();
  const codigosSet = f.codigos?.length ? new Set(f.codigos) : null;

  return docs.filter((d) => {
    if (f.estado && f.estado !== 'ALL' && d.estado !== f.estado) return false;
    if (f.tipoCP && f.tipoCP !== 'ALL' && d.tipo_doc_pago !== f.tipoCP) return false;

    if (f.existencia && f.existencia !== 'ALL') {
      if (f.existencia === 'AMBOS' && !(d.en_sap && d.en_sunat)) return false;
      if (f.existencia === 'SAP' && !d.en_sap) return false;
      if (f.existencia === 'SUNAT' && !d.en_sunat) return false;
      if (f.existencia === 'SOLO_SAP' && !(d.en_sap && !d.en_sunat)) return false;
      if (f.existencia === 'SOLO_SUNAT' && !(!d.en_sap && d.en_sunat)) return false;
    }

    if (f.categoria && f.categoria !== 'ALL') {
      if (f.categoria === 'DIF_IMPORTES' && !d.codigos.some((c) => CODIGOS_IMPORTES.includes(c))) return false;
      if (f.categoria === 'PROB_IDENTIDAD' && !d.codigos.some((c) => CODIGOS_IDENTIDAD.includes(c))) return false;
      if (f.categoria === 'CORTESIAS' && !d.cortesia) return false;
    }

    if (codigosSet && !d.codigos.some((c) => codigosSet.has(c))) return false;

    if (serieQ && !d.serie.toUpperCase().includes(serieQ)) return false;
    if (f.fechaDesde && (!d.fecha_emision || d.fecha_emision < f.fechaDesde)) return false;
    if (f.fechaHasta && (!d.fecha_emision || d.fecha_emision > f.fechaHasta)) return false;
    if (cDesde && compararCorrelativos(d.correlativo, cDesde) < 0) return false;
    if (cHasta && compararCorrelativos(d.correlativo, cHasta) > 0) return false;

    if (q) {
      const texto = [
        `${d.serie}-${d.correlativo}`,
        d.sap ? `${d.serie}-${d.sap.correlativo}` : '',
        d.sap?.nro_identidad || '',
        d.sunat?.nro_identidad || '',
        d.sap?.nombre || '',
        d.sunat?.nombre || '',
      ].join(' ').toLowerCase();
      if (!texto.includes(q)) return false;
    }
    return true;
  });
}

/**
 * Calcula los 10 indicadores generales requeridos en la sección 3.B + totales
 * monetarios y conteo por grupo de incidencia, sobre documentos únicos.
 */
export function calcularIndicadores(docs) {
  const ind = {
    totalUnicos: docs.length,
    totalSap: 0,
    totalSunat: 0,
    coincidentes: 0,
    correctos: 0,
    conObservaciones: 0,
    conErrores: 0,
    soloSap: 0,
    soloSunat: 0,
    conDifImportes: 0,
    conProbIdentidad: 0,
    cortesias: 0,
    anulados: 0,
    sumas: {
      base_sap: 0, igv_sap: 0, exonerado_sap: 0, inafecto_sap: 0, otros_sap: 0, total_sap: 0,
      base_sunat: 0, igv_sunat: 0, exonerado_sunat: 0, inafecto_sunat: 0, otros_sunat: 0, total_sunat: 0,
    },
    porCodigo: Object.fromEntries(INCIDENCIAS.map((i) => [i.codigo, 0])),
  };

  for (const d of docs) {
    if (d.en_sap) {
      ind.totalSap += 1;
      ind.sumas.base_sap += d.sap.base || 0;
      ind.sumas.igv_sap += d.sap.igv || 0;
      ind.sumas.exonerado_sap += d.sap.exonerado || 0;
      ind.sumas.inafecto_sap += d.sap.inafecto || 0;
      ind.sumas.otros_sap += d.sap.otros || 0;
      ind.sumas.total_sap += d.sap.total || 0;
    }
    if (d.en_sunat) {
      ind.totalSunat += 1;
      ind.sumas.base_sunat += d.sunat.base || 0;
      ind.sumas.igv_sunat += d.sunat.igv || 0;
      ind.sumas.exonerado_sunat += d.sunat.exonerado || 0;
      ind.sumas.inafecto_sunat += d.sunat.inafecto || 0;
      ind.sumas.otros_sunat += d.sunat.otros || 0;
      ind.sumas.total_sunat += d.sunat.total || 0;
    }
    if (d.en_sap && d.en_sunat) ind.coincidentes += 1;
    else if (d.en_sap) ind.soloSap += 1;
    else if (d.en_sunat) ind.soloSunat += 1;

    if (d.estado === 'OK') ind.correctos += 1;
    else if (d.estado === 'OBSERVADO') ind.conObservaciones += 1;
    else if (d.estado === 'ERROR') ind.conErrores += 1;

    if (d.codigos.some((c) => CODIGOS_IMPORTES.includes(c))) ind.conDifImportes += 1;
    if (d.codigos.some((c) => CODIGOS_IDENTIDAD.includes(c))) ind.conProbIdentidad += 1;
    if (d.cortesia) ind.cortesias += 1;
    if (d.anulado) ind.anulados += 1;

    for (const c of d.codigos) {
      if (ind.porCodigo[c] !== undefined) ind.porCodigo[c] += 1;
    }
  }
  return ind;
}

/** Reconstruye el resumen por serie y los saltos de secuencia sobre cualquier conjunto de docs. */
export function calcularSecuencias(docs) {
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
    let saltosSerie = 0;
    let faltantesSerie = 0;
    for (let i = 1; i < ordenados.length; i++) {
      const prev = ordenados[i - 1];
      const curr = ordenados[i];
      const dif = diferenciaCorrelativos(prev.correlativo, curr.correlativo);
      if (dif !== null && dif > 1) {
        saltosSerie += 1;
        faltantesSerie += dif - 1;
        saltos.push({
          doc: curr,
          tipo_doc_pago: curr.tipo_doc_pago,
          serie: curr.serie,
          anterior: prev.correlativo,
          fecha_anterior: prev.fecha_emision,
          siguiente: curr.correlativo,
          fecha_siguiente: curr.fecha_emision,
          diferencia: dif,
          faltantes: dif - 1,
        });
      }
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
      saltos: saltosSerie,
      faltantes: faltantesSerie,
      estado: saltosSerie === 0 ? 'CONTINUA' : 'CON SALTOS',
    });
  }
  series.sort((a, b) => a.serie.localeCompare(b.serie));
  return { series, saltos };
}

/** Obtiene (o recalcula para cargas v1) la evaluación de identidad de un documento. */
export function obtenerEvaluacionIdentidad(d) {
  if (d.anulado) return null;
  if (d.identidad) return d.identidad;
  const evSap = d.sap ? evaluarIdentidad(d.sap, d.tipo_doc_pago) : null;
  const evSunat = d.sunat ? evaluarIdentidad(d.sunat, d.tipo_doc_pago) : null;
  const sapCumple = evSap ? evSap.every((e) => e.ok) : null;
  const sunatCumple = evSunat ? evSunat.every((e) => e.ok) : null;
  return {
    sap: evSap,
    sunat: evSunat,
    sap_cumple: sapCumple,
    sunat_cumple: sunatCumple,
    sistema_correcto: sistemaCorrecto(d.en_sap, d.en_sunat, sapCumple, sunatCumple),
  };
}

/** Evalúa un documento para un reporte específico de identidad ('1', '6', '4', '0', 'FACTURA'). */
export function evaluarDocParaReporteIdentidad(d, tipoReporte) {
  const id = obtenerEvaluacionIdentidad(d);
  if (!id) return null;
  const reglaPorTipo = { '1': 'R-ID-02', '6': 'R-ID-03', '4': 'R-ID-04', '0': 'R-ID-06', FACTURA: 'R-ID-05' };
  const regla = reglaPorTipo[tipoReporte];
  const evSap = id.sap?.find((e) => e.regla === regla) || null;
  const evSunat = id.sunat?.find((e) => e.regla === regla) || null;
  if (!evSap && !evSunat) return null;

  const tSap = d.sap?.tipo_identidad ?? null;
  const tSun = d.sunat?.tipo_identidad ?? null;
  const nSap = d.sap?.nro_identidad ?? null;
  const nSun = d.sunat?.nro_identidad ?? null;
  const sapOk = evSap ? evSap.ok : false;
  const sunOk = evSunat ? evSunat.ok : false;
  const coinciden = d.en_sap && d.en_sunat && tSap === tSun && nSap === nSun;
  const ambosOk = sapOk && sunOk && coinciden;

  let sistema = 'NINGUNO';
  if (sapOk && sunOk) sistema = coinciden ? 'AMBOS' : 'AMBOS (DIFIEREN)';
  else if (sapOk) sistema = 'SAP';
  else if (sunOk) sistema = 'SUNAT';

  const motivos = [];
  if (!d.en_sap) motivos.push('No existe en SAP');
  else if (!evSap) motivos.push(`SAP registra tipo ${tSap || 'vacío'}`);
  else if (!evSap.ok) motivos.push(`SAP: ${evSap.motivo}`);
  if (!d.en_sunat) motivos.push('No existe en SUNAT');
  else if (!evSunat) motivos.push(`SUNAT registra tipo ${tSun || 'vacío'}`);
  else if (!evSunat.ok) motivos.push(`SUNAT: ${evSunat.motivo}`);
  if (sapOk && sunOk && !coinciden) motivos.push(`Diferencia SAP (${tSap}:${nSap}) vs SUNAT (${tSun}:${nSun})`);

  return {
    doc: d,
    resultado: ambosOk ? 'CORRECTO' : 'INCORRECTO',
    sistema_correcto: sistema,
    sap_ok: sapOk,
    sunat_ok: sunOk,
    motivo: motivos.length ? motivos.join(' · ') : 'Cumple en SAP y SUNAT',
  };
}

// ============================================================================
// 11. Catálogo de los 12 reportes específicos + Facturas (5.5)
// ============================================================================
export const REPORTES_ESPECIFICOS = [
  { id: 'resumen', titulo: '1. Resumen general SAP y SUNAT', corto: 'Resumen general' },
  { id: 'correctos', titulo: '2. Documentos correctos', corto: 'Correctos' },
  { id: 'errores', titulo: '3. Documentos con errores', corto: 'Con errores' },
  { id: 'observaciones', titulo: '4. Documentos con observaciones', corto: 'Con observaciones' },
  { id: 'dni', titulo: '5. Validación de DNI (Código 1 y Boletas > S/ 700)', corto: 'Validación DNI' },
  { id: 'ruc', titulo: '6. Validación de RUC (Boletas Cód. 6 y Facturas)', corto: 'Validación RUC' },
  { id: 'ce', titulo: '7. Validación de Carnet de Extranjería (Código 4)', corto: 'Carnet Extranjería' },
  { id: 'otros_id', titulo: '8. Validación de otros tipos de identidad (Código 0)', corto: 'Otros (Código 0)' },
  { id: 'importes', titulo: '9. Documentos con diferencias de importes', corto: 'Dif. de importes' },
  { id: 'sin_coincidencia', titulo: '10. Documentos sin coincidencia SAP vs SUNAT', corto: 'Sin coincidencia' },
  { id: 'secuencia', titulo: '11. Documentos con problemas de secuencia', corto: 'Secuencia correlativos' },
  { id: 'cortesias', titulo: '12. Validación de cortesías', corto: 'Cortesías' },
];

// ============================================================================
// 13. Exportación a Excel (respeta filtros aplicados y conserva datos originales)
// Incluye sanitización contra CSV / Excel Formula Injection (=, +, -, @, Tab, CR)
// ============================================================================
const escaparFormulaExcel = (val) => {
  if (typeof val !== 'string') return val;
  return /^[=+\-@\t\r]/.test(val) ? `'${val}` : val;
};

const sanitizarFilaExcel = (fila) => {
  if (!fila || typeof fila !== 'object') return fila;
  const out = {};
  for (const [k, v] of Object.entries(fila)) {
    out[k] = escaparFormulaExcel(v);
  }
  return out;
};

export function filaExcelPrincipal(d) {
  const totalSap = d.en_sap ? centimosADecimal(d.sap.total) : null;
  const totalSunat = d.en_sunat ? centimosADecimal(d.sunat.total) : null;
  const difTotal = d.en_sap && d.en_sunat ? centimosADecimal(d.sap.total - d.sunat.total) : null;
  return {
    'Número de documento': `${d.serie}-${d.correlativo}`,
    'Serie': d.serie,
    'Correlativo SUNAT': d.sunat?.correlativo ?? '',
    'Correlativo SAP': d.sap?.correlativo ?? '',
    'Fecha de emisión': d.fecha_emision || '',
    'Tipo de comprobante': `${d.tipo_doc_pago} - ${descripcionTipoCP(d.tipo_doc_pago)}`,
    'Tipo de identidad SAP': d.en_sap ? (d.sap.tipo_identidad ?? '') : 'NO EXISTE EN SAP',
    'Número de identidad SAP': d.en_sap ? (d.sap.nro_identidad ?? '') : '',
    'Nombre SAP': d.en_sap ? (d.sap.nombre ?? '') : '',
    'Tipo de identidad SUNAT': d.en_sunat ? (d.sunat.tipo_identidad ?? '') : 'NO EXISTE EN SUNAT',
    'Número de identidad SUNAT': d.en_sunat ? (d.sunat.nro_identidad ?? '') : '',
    'Nombre SUNAT': d.en_sunat ? (d.sunat.nombre ?? '') : '',
    'Base imponible SAP': d.en_sap ? centimosADecimal(d.sap.base) : '',
    'Base imponible SUNAT': d.en_sunat ? centimosADecimal(d.sunat.base) : '',
    'IGV SAP': d.en_sap ? centimosADecimal(d.sap.igv) : '',
    'IGV SUNAT': d.en_sunat ? centimosADecimal(d.sunat.igv) : '',
    'Exonerado SAP': d.en_sap ? centimosADecimal(d.sap.exonerado) : '',
    'Exonerado SUNAT': d.en_sunat ? centimosADecimal(d.sunat.exonerado) : '',
    'Inafecto SAP': d.en_sap ? centimosADecimal(d.sap.inafecto) : '',
    'Inafecto SUNAT': d.en_sunat ? centimosADecimal(d.sunat.inafecto) : '',
    'Otros tributos SAP': d.en_sap ? centimosADecimal(d.sap.otros) : '',
    'Otros tributos SUNAT': d.en_sunat ? centimosADecimal(d.sunat.otros) : '',
    'Total SAP': totalSap ?? '',
    'Total SUNAT': totalSunat ?? '',
    'Diferencia Total (SAP - SUNAT)': difTotal ?? '',
    'Estado': ESTADOS[d.estado]?.etiqueta || d.estado,
    'Códigos incidencia': d.codigos.join(', '),
    'Detalle de incidencias': d.incidencias.map((i) => `${i.codigo}: ${i.detalle}`).join(' | '),
  };
}

function filaExcelIdentidad(ev) {
  const d = ev.doc;
  return {
    'Número de comprobante': `${d.serie}-${d.correlativo}`,
    'Fecha': d.fecha_emision || '',
    'Tipo CP': descripcionTipoCP(d.tipo_doc_pago),
    'Tipo de identidad en SAP': d.en_sap ? descripcionTipoIdentidad(d.sap.tipo_identidad) : 'NO EXISTE EN SAP',
    'Número de identidad en SAP': d.en_sap ? (d.sap.nro_identidad ?? '') : '',
    'Nombre en SAP': d.en_sap ? (d.sap.nombre ?? '') : '',
    'Tipo de identidad en SUNAT': d.en_sunat ? descripcionTipoIdentidad(d.sunat.tipo_identidad) : 'NO EXISTE EN SUNAT',
    'Número de identidad en SUNAT': d.en_sunat ? (d.sunat.nro_identidad ?? '') : '',
    'Nombre en SUNAT': d.en_sunat ? (d.sunat.nombre ?? '') : '',
    'Total SAP': d.en_sap ? centimosADecimal(d.sap.total) : '',
    'Total SUNAT': d.en_sunat ? centimosADecimal(d.sunat.total) : '',
    'Resultado de la validación': ev.resultado,
    'Sistema con dato correcto': ev.sistema_correcto,
    'Detalle': ev.motivo,
  };
}

export function exportarExcelVentas({ tipo, docs, todosDocs, periodo = 'periodo' }) {
  const wb = XLSX.utils.book_new();
  const ind = calcularIndicadores(docs);
  const agregarHoja = (nombre, filas) => {
    const filasSeguras = filas.length
      ? filas.map(sanitizarFilaExcel)
      : [{ Mensaje: 'Sin registros para los criterios seleccionados' }];
    const ws = XLSX.utils.json_to_sheet(filasSeguras);
    XLSX.utils.book_append_sheet(wb, ws, nombre.slice(0, 31));
  };

  if (tipo === 'resumen' || tipo === 'completo') {
    const resumen = [
      { Indicador: 'Total de documentos registrados en SAP', Valor: ind.totalSap },
      { Indicador: 'Total de documentos registrados en SUNAT', Valor: ind.totalSunat },
      { Indicador: 'Total de documentos únicos evaluados', Valor: ind.totalUnicos },
      { Indicador: 'Total de documentos coincidentes (SAP y SUNAT)', Valor: ind.coincidentes },
      { Indicador: 'Total de documentos correctos', Valor: ind.correctos },
      { Indicador: 'Total de documentos con observaciones', Valor: ind.conObservaciones },
      { Indicador: 'Total de documentos con errores', Valor: ind.conErrores },
      { Indicador: 'Documentos existentes únicamente en SAP (OBS 5)', Valor: ind.soloSap },
      { Indicador: 'Documentos existentes únicamente en SUNAT (OBS 4)', Valor: ind.soloSunat },
      { Indicador: 'Total de documentos con diferencias de importes', Valor: ind.conDifImportes },
      { Indicador: 'Total de documentos con problemas de identificación', Valor: ind.conProbIdentidad },
      { Indicador: 'Total de cortesías identificadas', Valor: ind.cortesias },
      ...INCIDENCIAS.map((i) => ({
        Indicador: `${i.codigo} - ${i.descripcion}`,
        Valor: ind.porCodigo[i.codigo] || 0,
      })),
    ];
    agregarHoja('Resumen General', resumen);
    const comparativa = [
      ['BI Gravada', ind.sumas.base_sap, ind.sumas.base_sunat],
      ['IGV / IPM', ind.sumas.igv_sap, ind.sumas.igv_sunat],
      ['Monto Exonerado', ind.sumas.exonerado_sap, ind.sumas.exonerado_sunat],
      ['Monto Inafecto', ind.sumas.inafecto_sap, ind.sumas.inafecto_sunat],
      ['Otros Tributos', ind.sumas.otros_sap, ind.sumas.otros_sunat],
      ['Importe Total', ind.sumas.total_sap, ind.sumas.total_sunat],
    ].map(([c, s, u]) => ({
      Concepto: c,
      'Importe SAP': centimosADecimal(s),
      'Importe SUNAT': centimosADecimal(u),
      Diferencia: centimosADecimal(s - u),
      Resultado: dentroDeTolerancia(s - u) ? 'CORRECTO' : 'ERROR',
    }));
    agregarHoja('Comparativa Monetaria', comparativa);
  }

  if (tipo === 'vista_actual' || tipo === 'completo') {
    agregarHoja('Detalle Comparativo', docs.map(filaExcelPrincipal));
  }
  if (tipo === 'correctos' || tipo === 'completo') {
    agregarHoja('Correctos', docs.filter((d) => d.estado === 'OK').map(filaExcelPrincipal));
  }
  if (tipo === 'observaciones' || tipo === 'completo') {
    agregarHoja('Observados', docs.filter((d) => d.estado === 'OBSERVADO').map(filaExcelPrincipal));
  }
  if (tipo === 'errores' || tipo === 'completo') {
    agregarHoja('Con Errores', docs.filter((d) => d.estado === 'ERROR').map(filaExcelPrincipal));
  }
  if (tipo === 'por_incidencia') {
    for (const inc of INCIDENCIAS) {
      const afectados = docs.filter((d) => d.codigos.includes(inc.codigo));
      if (afectados.length) agregarHoja(`${inc.codigo} ${inc.corto}`, afectados.map(filaExcelPrincipal));
    }
    if (!wb.SheetNames.length) agregarHoja('Sin incidencias', []);
  }
  if (tipo === 'dni') {
    const filas = docs.map((d) => evaluarDocParaReporteIdentidad(d, '1')).filter(Boolean).map(filaExcelIdentidad);
    const b700 = docs
      .filter((d) => d.tipo_doc_pago === '03' && ((d.sap?.total || 0) > 70000 || (d.sunat?.total || 0) > 70000))
      .map((d) => ({
        'Número de comprobante': `${d.serie}-${d.correlativo}`,
        'Fecha': d.fecha_emision || '',
        'Tipo identidad SAP': d.sap?.tipo_identidad ?? 'NO EXISTE',
        'Nro identidad SAP': d.sap?.nro_identidad ?? '',
        'Nombre SAP': d.sap?.nombre ?? '',
        'Total SAP': d.en_sap ? centimosADecimal(d.sap.total) : '',
        'Tipo identidad SUNAT': d.sunat?.tipo_identidad ?? 'NO EXISTE',
        'Nro identidad SUNAT': d.sunat?.nro_identidad ?? '',
        'Nombre SUNAT': d.sunat?.nombre ?? '',
        'Total SUNAT': d.en_sunat ? centimosADecimal(d.sunat.total) : '',
        'Resultado': d.codigos.includes('ERROR 6') ? 'ERROR: SIN DNI' : 'CORRECTO',
      }));
    agregarHoja('DNI Codigo 1', filas);
    agregarHoja('Boletas mayor 700', b700);
  }
  if (tipo === 'ruc') {
    const bol = docs.map((d) => evaluarDocParaReporteIdentidad(d, '6')).filter(Boolean).map(filaExcelIdentidad);
    const fac = docs.map((d) => evaluarDocParaReporteIdentidad(d, 'FACTURA')).filter(Boolean).map(filaExcelIdentidad);
    agregarHoja('RUC en Boletas (10)', bol);
    agregarHoja('Facturas (RUC 10-20)', fac);
  }
  if (tipo === 'ce') {
    agregarHoja('Carnet Extranjeria', docs.map((d) => evaluarDocParaReporteIdentidad(d, '4')).filter(Boolean).map(filaExcelIdentidad));
  }
  if (tipo === 'otros_id') {
    agregarHoja('Otros Codigo 0', docs.map((d) => evaluarDocParaReporteIdentidad(d, '0')).filter(Boolean).map(filaExcelIdentidad));
  }
  if (tipo === 'importes') {
    const filas = [];
    for (const d of docs.filter((x) => x.en_sap && x.en_sunat)) {
      const { comparacion } = validarImportes(d);
      for (const c of comparacion) {
        if (!c.ok) {
          filas.push({
            'Número de comprobante': `${d.serie}-${d.correlativo}`,
            'Fecha': d.fecha_emision || '',
            'Tipo CP': descripcionTipoCP(d.tipo_doc_pago),
            'Código Error': c.codigo,
            'Concepto con diferencia': c.concepto,
            'Importe SAP': centimosADecimal(c.sap),
            'Importe SUNAT': centimosADecimal(c.sunat),
            'Diferencia (SAP - SUNAT)': centimosADecimal(c.diferencia),
            'Resultado': 'ERROR (> S/ 0.05)',
          });
        }
      }
    }
    agregarHoja('Diferencias por Concepto', filas);
    agregarHoja('Comprobantes con Dif', docs.filter((d) => d.codigos.some((c) => CODIGOS_IMPORTES.includes(c))).map(filaExcelPrincipal));
  }
  if (tipo === 'sin_coincidencia') {
    agregarHoja('Solo en SUNAT (OBS 4)', docs.filter((d) => !d.en_sap && d.en_sunat).map(filaExcelPrincipal));
    agregarHoja('Solo en SAP (OBS 5)', docs.filter((d) => d.en_sap && !d.en_sunat).map(filaExcelPrincipal));
  }
  if (tipo === 'secuencia') {
    const { series, saltos } = calcularSecuencias(todosDocs || docs);
    agregarHoja('Resumen por Serie', series.map((s) => ({
      'Tipo CP': descripcionTipoCP(s.tipo_doc_pago),
      'Serie': s.serie,
      'Documentos registrados': s.documentos,
      'Primer correlativo': s.primero,
      'Último correlativo': s.ultimo,
      'Saltos detectados': s.saltos,
      'Correlativos faltantes': s.faltantes,
      'Estado de secuencia': s.estado,
    })));
    agregarHoja('Saltos de Secuencia', saltos.map((s) => ({
      'Serie afectada': s.serie,
      'Tipo CP': descripcionTipoCP(s.tipo_doc_pago),
      'Correlativo anterior': s.anterior,
      'Fecha anterior': s.fecha_anterior || '',
      'Correlativo siguiente': s.siguiente,
      'Fecha siguiente': s.fecha_siguiente || '',
      'Diferencia de correlativos': s.diferencia,
      'Correlativos faltantes': s.faltantes,
    })));
  }
  if (tipo === 'cortesias') {
    const filas = docs.filter((d) => d.cortesia).map((d) => ({
      'Número de comprobante': `${d.serie}-${d.correlativo}`,
      'Fecha': d.fecha_emision || '',
      'BI SAP': d.en_sap ? centimosADecimal(d.sap.base) : '',
      'IGV SAP': d.en_sap ? centimosADecimal(d.sap.igv) : '',
      'Otros SAP': d.en_sap ? centimosADecimal(d.sap.otros) : '',
      'Total SAP': d.en_sap ? centimosADecimal(d.sap.total) : '',
      'BI SUNAT': d.en_sunat ? centimosADecimal(d.sunat.base) : '',
      'IGV SUNAT': d.en_sunat ? centimosADecimal(d.sunat.igv) : '',
      'Otros SUNAT': d.en_sunat ? centimosADecimal(d.sunat.otros) : '',
      'Total SUNAT': d.en_sunat ? centimosADecimal(d.sunat.total) : '',
      'Op. Gratuitas SUNAT': d.en_sunat ? centimosADecimal(d.sunat.op_gratuitas) : '',
      'En Excel Cortesías': d.cortesia.en_excel === null ? 'No cargado' : d.cortesia.en_excel ? 'SÍ' : 'NO',
      'Detalle Excel': d.cortesia.excel?.detalle || '',
      'Observación Excel': d.cortesia.excel?.observacion || '',
      'Resultado validación': d.cortesia.resultado,
      'Motivo': d.cortesia.motivos?.join(' · ') || 'Importes de cortesía correctos en SAP y SUNAT',
    }));
    agregarHoja('Cortesias', filas);
  }

  const limpio = String(periodo || 'periodo').replace(/[^a-zA-Z0-9_-]/g, '_');
  XLSX.writeFile(wb, `Conciliacion_Ventas_${tipo}_${limpio}.xlsx`);
}
