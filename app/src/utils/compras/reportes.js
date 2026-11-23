// ============================================================================
// Filtros, indicadores generales y exportación Excel del módulo de Compras.
//  - Soporta los 7 indicadores del Panel Resumen (Sección 7.A).
//  - Soporta filtros por estado, tipo de error, tipo de observación, RUC,
//    razón social, tipo de documento, serie y fechas (Sección 7.C).
//  - Exporta a Excel con todas las hojas requeridas (Sección 8), respetando
//    filtros o exportando la totalidad de los resultados, con sanitización
//    contra CSV/Formula Injection.
// ============================================================================
import {
  INCIDENCIAS_COMPRAS,
  RESULTADOS_COMPRAS,
  CONCEPTOS_IMPORTE_COMPRAS,
  TIPO,
  descripcionTipoDocCompras,
  descripcionTipoIdentidadCompras,
} from './catalogos.js';
import { centimosADecimal } from '../ventas/montos.js';
import { sanitizeExcelRow } from '../excelSanitizer.js';

export const FILTROS_INICIALES_COMPRAS = {
  busqueda: '',
  ruc: '',
  razonSocial: '',
  docSap: '',
  usuarioSap: 'ALL',  // ALL | SIN_USUARIO | <usuario>
  resultado: 'ALL',   // ALL | OK | CON_DIFERENCIAS | CON_OBSERVACIONES | NO_EXISTE_SUNAT | NO_EXISTE_SAP
  tipoError: 'ALL',   // ALL | ERROR 1 .. ERROR 8
  tipoObs: 'ALL',     // ALL | OBS 1 .. OBS 3
  codigos: [],        // multi-selección de chips (ERROR 1..8, OBS 1..3)
  tipoDoc: 'ALL',     // ALL | 01 | 07 | 09 | 14 | ...
  serie: '',
  origen: 'ALL',      // ALL | SAP | SUNAT | AMBOS
  fechaDesde: '',
  fechaHasta: '',
};

/** Filtra los documentos conciliados de Compras según todos los criterios activos. */
export function filtrarDocumentosCompras(docs, f = FILTROS_INICIALES_COMPRAS) {
  const q = (f.busqueda || '').trim().toLowerCase();
  const rucQ = (f.ruc || '').trim().toLowerCase();
  const razonQ = (f.razonSocial || '').trim().toLowerCase();
  const docSapQ = (f.docSap || '').trim().toLowerCase();
  const usuarioSapQ = (f.usuarioSap || 'ALL').trim();
  const serieQ = (f.serie || '').trim().toUpperCase();
  const codigosSet = f.codigos?.length ? new Set(f.codigos) : null;

  return docs.filter((d) => {
    if (f.resultado && f.resultado !== 'ALL' && d.resultado !== f.resultado) return false;

    if (f.origen && f.origen !== 'ALL') {
      if (f.origen === 'SAP' && !d.en_sap) return false;
      if (f.origen === 'SUNAT' && !d.en_sunat) return false;
      if (f.origen === 'AMBOS' && !(d.en_sap && d.en_sunat)) return false;
    }

    if (f.tipoError && f.tipoError !== 'ALL' && !d.codigosError.includes(f.tipoError)) return false;
    if (f.tipoObs && f.tipoObs !== 'ALL' && !d.codigosObs.includes(f.tipoObs)) return false;
    if (codigosSet && !d.codigos.some((c) => codigosSet.has(c))) return false;

    if (f.tipoDoc && f.tipoDoc !== 'ALL' && d.tipo_doc_pago !== f.tipoDoc) return false;
    if (serieQ && !String(d.serie || '').toUpperCase().includes(serieQ)) return false;

    if (docSapQ) {
      const nroDocSap = String(d.sap?.doc_interno || d.nro_doc_sap || '').toLowerCase();
      if (!nroDocSap.includes(docSapQ)) return false;
    }

    if (usuarioSapQ && usuarioSapQ !== 'ALL') {
      const usr = String(d.sap?.usuario_sap || d.usuario_sap || '').trim();
      if (usuarioSapQ === 'SIN_USUARIO') {
        if (usr !== '') return false;
      } else if (usr.toLowerCase() !== usuarioSapQ.toLowerCase()) {
        return false;
      }
    }

    if (rucQ) {
      const rucs = [d.ruc_proveedor, d.sap?.nro_identidad, d.sunat?.nro_identidad]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!rucs.includes(rucQ)) return false;
    }

    if (razonQ) {
      const nombres = [d.razon_social, d.sap?.nombre, d.sunat?.nombre]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!nombres.includes(razonQ)) return false;
    }

    if (f.fechaDesde || f.fechaHasta) {
      const fechas = [d.sap?.fecha_emision, d.sunat?.fecha_emision, d.fecha_emision].filter(Boolean);
      if (fechas.length === 0) return false;
      const coincideFecha = fechas.some((fe) => {
        if (f.fechaDesde && fe < f.fechaDesde) return false;
        if (f.fechaHasta && fe > f.fechaHasta) return false;
        return true;
      });
      if (!coincideFecha) return false;
    }

    if (q) {
      const texto = [
        d.clave_legible,
        d.sap?.doc_interno,
        d.nro_doc_sap,
        d.sap?.usuario_sap,
        d.usuario_sap,
        d.ruc_proveedor,
        d.sap?.nro_identidad,
        d.sunat?.nro_identidad,
        d.razon_social,
        d.sap?.nombre,
        d.sunat?.nombre,
        `${d.serie}-${d.correlativo}`,
        d.tipo_doc_pago,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!texto.includes(q)) return false;
    }

    return true;
  });
}

/**
 * Extrae la lista completa y deduplicada de N° de documento SAP para copiar al
 * portapapeles (uno por línea, listo para "Selección múltiple -> Portapapeles"
 * en SAP SE16N / BKPF), ignorando cualquier paginación de la tabla.
 */
export function obtenerDocsSapParaCopiar(docs = [], { soloConError = true } = {}) {
  const vistos = new Set();
  const lista = [];
  for (const d of docs) {
    if (!d?.en_sap) continue;
    if (soloConError && !(d.codigosError && d.codigosError.length > 0)) continue;
    const nro = String(d.sap?.doc_interno || d.nro_doc_sap || '').trim();
    if (!nro || vistos.has(nro)) continue;
    vistos.add(nro);
    lista.push(nro);
  }
  return {
    lista,
    texto: lista.join('\n'),
    total: lista.length,
  };
}

/**
 * Calcula los 7 indicadores generales del Panel Resumen + sumas monetarias
 * (coincidentes y total lote) + conteos por cada Error (1..8) y Observación (1..3).
 */
export function calcularIndicadoresCompras(docs) {
  const sumasVacias = () => ({
    base_sap: 0, igv_sap: 0, valor_adquisicion_sap: 0, otros_sap: 0, total_sap: 0,
    base_sunat: 0, igv_sunat: 0, valor_adquisicion_sunat: 0, otros_sunat: 0, total_sunat: 0,
  });

  const ind = {
    totalUnicos: docs.length,
    totalSap: 0,
    totalSunat: 0,
    coincidentes: 0,
    ok: 0,
    conDiferencias: 0,
    conObservaciones: 0,
    noExisteSunat: 0,
    noExisteSap: 0,
    conCualquierObs: 0,
    conCualquierError: 0,
    tipo14Ok: 0,
    totalHallazgosError: 0,
    totalHallazgosObs: 0,
    sumas: sumasVacias(),
    sumasCoincidentes: sumasVacias(),
    porCodigo: Object.fromEntries(INCIDENCIAS_COMPRAS.map((i) => [i.codigo, 0])),
  };

  for (const d of docs) {
    if (d.en_sap) {
      ind.totalSap += 1;
      ind.sumas.base_sap += d.sap.base || 0;
      ind.sumas.igv_sap += d.sap.igv || 0;
      ind.sumas.valor_adquisicion_sap += d.sap.valor_adquisicion || 0;
      ind.sumas.otros_sap += d.sap.otros || 0;
      ind.sumas.total_sap += d.sap.total || 0;
    }
    if (d.en_sunat) {
      ind.totalSunat += 1;
      ind.sumas.base_sunat += d.sunat.base || 0;
      ind.sumas.igv_sunat += d.sunat.igv || 0;
      ind.sumas.valor_adquisicion_sunat += d.sunat.valor_adquisicion || 0;
      ind.sumas.otros_sunat += d.sunat.otros || 0;
      ind.sumas.total_sunat += d.sunat.total || 0;
    }
    if (d.en_sap && d.en_sunat) {
      ind.coincidentes += 1;
      ind.sumasCoincidentes.base_sap += d.sap.base || 0;
      ind.sumasCoincidentes.igv_sap += d.sap.igv || 0;
      ind.sumasCoincidentes.valor_adquisicion_sap += d.sap.valor_adquisicion || 0;
      ind.sumasCoincidentes.otros_sap += d.sap.otros || 0;
      ind.sumasCoincidentes.total_sap += d.sap.total || 0;
      ind.sumasCoincidentes.base_sunat += d.sunat.base || 0;
      ind.sumasCoincidentes.igv_sunat += d.sunat.igv || 0;
      ind.sumasCoincidentes.valor_adquisicion_sunat += d.sunat.valor_adquisicion || 0;
      ind.sumasCoincidentes.otros_sunat += d.sunat.otros || 0;
      ind.sumasCoincidentes.total_sunat += d.sunat.total || 0;
    }

    if (d.resultado === 'OK') ind.ok += 1;
    else if (d.resultado === 'CON_DIFERENCIAS') ind.conDiferencias += 1;
    else if (d.resultado === 'CON_OBSERVACIONES') ind.conObservaciones += 1;
    else if (d.resultado === 'NO_EXISTE_SUNAT') ind.noExisteSunat += 1;
    else if (d.resultado === 'NO_EXISTE_SAP') ind.noExisteSap += 1;

    if (d.en_sap && !d.en_sunat && d.tipo_doc_pago === '14' && d.resultado === 'OK') {
      ind.tipo14Ok += 1;
    }

    if (d.codigosError.length > 0) ind.conCualquierError += 1;
    if (d.codigosObs.length > 0) ind.conCualquierObs += 1;

    for (const c of d.codigosError) {
      if (ind.porCodigo[c] !== undefined) ind.porCodigo[c] += 1;
      ind.totalHallazgosError += 1;
    }
    for (const c of d.codigosObs) {
      if (ind.porCodigo[c] !== undefined) ind.porCodigo[c] += 1;
      ind.totalHallazgosObs += 1;
    }
  }

  return ind;
}

/** Convierte un documento conciliado a una fila lista para Excel (preservando ceros a la izquierda). */
export function filaExcelCompras(d) {
  const resInfo = RESULTADOS_COMPRAS[d.resultado] || RESULTADOS_COMPRAS.OK;
  const erroresTxt = d.incidencias
    .filter((i) => i.tipo === TIPO.ERROR)
    .map((i) => `${i.codigo}: ${i.descripcion}`)
    .join(' | ');
  const obsTxt = d.incidencias
    .filter((i) => i.tipo === TIPO.OBS)
    .map((i) => `${i.codigo}: ${i.descripcion}`)
    .join(' | ');

  return sanitizeExcelRow({
    'Clave de Validación': d.clave_legible,
    'N° Documento SAP': d.en_sap ? (d.sap?.doc_interno || d.nro_doc_sap || '') : '',
    'Usuario SAP': d.en_sap ? (d.sap?.usuario_sap || d.usuario_sap || '') : '',
    'RUC Proveedor': d.ruc_proveedor || '',
    'Razón Social': d.razon_social || '',
    'Tipo Documento': descripcionTipoDocCompras(d.tipo_doc_pago),
    'Código Tipo Doc': d.tipo_doc_pago || '',
    'Serie': d.serie || '',
    'Correlativo': d.correlativo || '',
    'Fecha Emisión SAP': d.en_sap ? (d.sap.fecha_emision || '') : '',
    'Fecha Emisión SUNAT': d.en_sunat ? (d.sunat.fecha_emision || '') : '',
    'Tipo ID SAP': d.en_sap ? descripcionTipoIdentidadCompras(d.sap.tipo_identidad) : '',
    'Tipo ID SUNAT': d.en_sunat ? descripcionTipoIdentidadCompras(d.sunat.tipo_identidad) : '',
    'Nro ID SAP': d.en_sap ? (d.sap.nro_identidad || '') : '',
    'Nro ID SUNAT': d.en_sunat ? (d.sunat.nro_identidad || '') : '',
    'Base SAP': d.en_sap ? centimosADecimal(d.sap.base) : '',
    'Base SUNAT': d.en_sunat ? centimosADecimal(d.sunat.base) : '',
    'Dif. Base': d.en_sap && d.en_sunat ? centimosADecimal(d.sap.base - d.sunat.base) : '',
    'IGV SAP': d.en_sap ? centimosADecimal(d.sap.igv) : '',
    'IGV SUNAT': d.en_sunat ? centimosADecimal(d.sunat.igv) : '',
    'Dif. IGV': d.en_sap && d.en_sunat ? centimosADecimal(d.sap.igv - d.sunat.igv) : '',
    'Valor Adquisición SAP': d.en_sap ? centimosADecimal(d.sap.valor_adquisicion) : '',
    'Valor Adquisición SUNAT': d.en_sunat ? centimosADecimal(d.sunat.valor_adquisicion) : '',
    'Dif. Valor Adquisición': d.en_sap && d.en_sunat ? centimosADecimal(d.sap.valor_adquisicion - d.sunat.valor_adquisicion) : '',
    'Otros Trib./Cargos SAP': d.en_sap ? centimosADecimal(d.sap.otros) : '',
    'Otros Trib./Cargos SUNAT': d.en_sunat ? centimosADecimal(d.sunat.otros) : '',
    'Dif. Otros Trib./Cargos': d.en_sap && d.en_sunat ? centimosADecimal(d.sap.otros - d.sunat.otros) : '',
    'Total SAP': d.en_sap ? centimosADecimal(d.sap.total) : '',
    'Total SUNAT': d.en_sunat ? centimosADecimal(d.sunat.total) : '',
    'Dif. Total': d.en_sap && d.en_sunat ? centimosADecimal(d.sap.total - d.sunat.total) : '',
    'Estado Validación': resInfo.etiqueta,
    'Errores Detectados': erroresTxt || 'Ninguno',
    'Observaciones Detectadas': obsTxt || 'Ninguna',
    'Línea Origen SAP': d.sap?.linea ?? '',
    'Línea Origen SUNAT': d.sunat?.linea ?? '',
  });
}

/** Construye las hojas del libro Excel de Compras (reutilizable en pruebas y navegador). */
export function construirDatosExcelCompras(docs) {
  const ind = calcularIndicadoresCompras(docs);

  const usuariosConError = new Map();
  for (const d of docs) {
    const usr = d.en_sap ? (d.sap?.usuario_sap || d.usuario_sap || '').trim() : '';
    if (usr && d.codigosError.length > 0) {
      usuariosConError.set(usr, (usuariosConError.get(usr) || 0) + 1);
    }
  }
  const filasUsuariosError =
    usuariosConError.size > 0
      ? [
          { Indicador: '', Cantidad: '' },
          { Indicador: '--- DOCUMENTOS CON ERROR POR USUARIO SAP ---', Cantidad: '' },
          ...[...usuariosConError.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([usuario, cantidad]) => ({
              Indicador: `Usuario SAP: ${usuario}`,
              Cantidad: cantidad,
            })),
        ]
      : [];

  const resumenIndicadores = [
    { Indicador: 'Total documentos únicos (SAP ∪ SUNAT)', Cantidad: ind.totalUnicos },
    { Indicador: 'Total documentos en SAP', Cantidad: ind.totalSap },
    { Indicador: 'Total documentos en SUNAT', Cantidad: ind.totalSunat },
    { Indicador: 'Documentos coincidentes (SAP y SUNAT)', Cantidad: ind.coincidentes },
    { Indicador: 'Documentos OK', Cantidad: ind.ok },
    { Indicador: '  ↳ Recibos Tipo 14 considerados OK (no migran a SUNAT)', Cantidad: ind.tipo14Ok },
    { Indicador: 'Documentos CON DIFERENCIAS', Cantidad: ind.conDiferencias },
    { Indicador: 'Documentos CON OBSERVACIONES', Cantidad: ind.conObservaciones },
    { Indicador: 'Documentos que NO EXISTEN EN SUNAT', Cantidad: ind.noExisteSunat },
    { Indicador: 'Documentos que NO EXISTEN EN SAP', Cantidad: ind.noExisteSap },
    { Indicador: '', Cantidad: '' },
    { Indicador: '--- DESGLOSE POR CÓDIGO DE ERROR Y OBSERVACIÓN ---', Cantidad: '' },
    ...INCIDENCIAS_COMPRAS.map((inc) => ({
      Indicador: `${inc.codigo}: ${inc.descripcion}`,
      Cantidad: ind.porCodigo[inc.codigo] || 0,
    })),
    { Indicador: '', Cantidad: '' },
    { Indicador: '--- COMPARATIVA MONETARIA (COINCIDENTES) ---', Cantidad: '' },
    ...CONCEPTOS_IMPORTE_COMPRAS.map((c) => {
      const s = ind.sumasCoincidentes[`${c.campo}_sap`];
      const u = ind.sumasCoincidentes[`${c.campo}_sunat`];
      return {
        Indicador: `${c.concepto} — SAP: ${centimosADecimal(s).toFixed(2)} | SUNAT: ${centimosADecimal(u).toFixed(2)} | Dif:`,
        Cantidad: centimosADecimal(s - u),
      };
    }),
    ...filasUsuariosError,
  ].map(sanitizeExcelRow);

  const detalleErrores = [];
  for (const d of docs) {
    const incs = d.incidencias.filter((i) => i.tipo === TIPO.ERROR || i.tipo === TIPO.OBS);
    for (const inc of incs) {
      detalleErrores.push(
        sanitizeExcelRow({
          'Clave de Validación': d.clave_legible,
          'N° Documento SAP': d.en_sap ? (d.sap?.doc_interno || d.nro_doc_sap || '') : '',
          'Usuario SAP': d.en_sap ? (d.sap?.usuario_sap || d.usuario_sap || '') : '',
          'RUC Proveedor': d.ruc_proveedor || '',
          'Razón Social': d.razon_social || '',
          'Tipo Documento': descripcionTipoDocCompras(d.tipo_doc_pago),
          'Serie': d.serie || '',
          'Correlativo': d.correlativo || '',
          'Estado Validación': (RESULTADOS_COMPRAS[d.resultado] || RESULTADOS_COMPRAS.OK).etiqueta,
          'Categoría': inc.tipo === TIPO.ERROR ? 'ERROR' : 'OBSERVACIÓN',
          'Código': inc.codigo,
          'Descripción': inc.descripcion,
          'Detalle': inc.detalle,
          'Regla': inc.regla || '',
          'Línea SAP': d.sap?.linea ?? '',
          'Línea SUNAT': d.sunat?.linea ?? '',
        })
      );
    }
  }

  return {
    'Resumen General': resumenIndicadores,
    'Documentos OK': docs.filter((d) => d.resultado === 'OK').map(filaExcelCompras),
    'Con Diferencias': docs.filter((d) => d.resultado === 'CON_DIFERENCIAS').map(filaExcelCompras),
    'Con Observaciones': docs
      .filter((d) => d.resultado === 'CON_OBSERVACIONES' || d.codigosObs.length > 0)
      .map(filaExcelCompras),
    'No Existen en SUNAT': docs.filter((d) => d.resultado === 'NO_EXISTE_SUNAT').map(filaExcelCompras),
    'No Existen en SAP': docs.filter((d) => d.resultado === 'NO_EXISTE_SAP').map(filaExcelCompras),
    'Detalle de Errores': detalleErrores,
    'Conciliacion Completa': docs.map(filaExcelCompras),
  };
}

/** Exporta los resultados de Compras a un archivo .xlsx descargable en el navegador. */
export async function exportarExcelCompras({ docs, alcance = 'completo', periodo = 'periodo' }) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const hojas = construirDatosExcelCompras(docs);

  for (const [nombre, filas] of Object.entries(hojas)) {
    const ws = filas.length
      ? XLSX.utils.json_to_sheet(filas)
      : XLSX.utils.aoa_to_sheet([['Sin registros para esta hoja']]);
    XLSX.utils.book_append_sheet(wb, ws, nombre.slice(0, 31));
  }

  const limpio = String(periodo || 'periodo').replace(/[^a-zA-Z0-9_-]/g, '_');
  const sufijo = alcance === 'filtrado' ? 'Filtrado' : 'Completo';
  XLSX.writeFile(wb, `Conciliacion_Compras_${sufijo}_${limpio}.xlsx`);
}
