// ============================================================================
// Reglas puras de validación y clasificación del módulo de Compras (SAP vs SUNAT).
//  - 8 Errores (ERROR 1 a ERROR 8), incluyendo excepción de Tipo 14 = OK.
//  - 3 Observaciones independientes (OBS 1 a OBS 3).
//  - Precisión decimal exacta en céntimos enteros para comparaciones monetarias.
//  - Nunca sobrescribe una incidencia con otra: todas se acumulan.
// ============================================================================
import {
  TIPO,
  INCIDENCIA_COMPRAS_POR_CODIGO,
  CONCEPTOS_IMPORTE_COMPRAS,
  TIPOS_DOC_PERMITIDOS,
  TIPO_DOC_EXCEPCION_RECIBO,
  RESULTADOS_COMPRAS,
  descripcionTipoDocCompras,
  descripcionTipoIdentidadCompras,
} from './catalogos.js';
import { formatoMonto } from '../ventas/montos.js';
import { normalizarTipoDocCompras, normalizarTipoIdentidad } from './documento.js';

export function crearIncidenciaCompras(codigo, regla, detalle, datos = {}) {
  const def = INCIDENCIA_COMPRAS_POR_CODIGO[codigo];
  return {
    codigo,
    tipo: def ? def.tipo : TIPO.INFO,
    descripcion: def ? def.descripcion : codigo,
    detalle,
    regla,
    datos,
  };
}

/**
 * Compara los 5 importes económicos (Errores 1 al 5) usando precisión decimal exacta
 * en céntimos enteros. Solo aplica cuando el documento existe en SAP y SUNAT.
 */
export function validarImportesCompras(doc) {
  const incidencias = [];
  const comparacion = [];

  if (!doc.en_sap || !doc.en_sunat) {
    return { incidencias, comparacion };
  }

  for (const c of CONCEPTOS_IMPORTE_COMPRAS) {
    const valSap = doc.sap?.[c.campo] ?? 0;
    const valSunat = doc.sunat?.[c.campo] ?? 0;
    const diff = valSap - valSunat;
    const ok = diff === 0;

    comparacion.push({
      ...c,
      sap: valSap,
      sunat: valSunat,
      diferencia: diff,
      ok,
    });

    if (!ok) {
      incidencias.push(
        crearIncidenciaCompras(
          c.codigo,
          c.regla,
          `${c.concepto}: SAP S/ ${formatoMonto(valSap)} vs SUNAT S/ ${formatoMonto(valSunat)} (Diferencia: S/ ${formatoMonto(diff)})`,
          { campo: c.campo, sap: valSap, sunat: valSunat, diferencia: diff }
        )
      );
    }
  }

  return { incidencias, comparacion };
}

/**
 * Valida la fecha de emisión entre SAP y SUNAT (Error 7).
 */
export function validarFechaEmisionCompras(doc) {
  if (!doc.en_sap || !doc.en_sunat) return [];
  const fSap = doc.sap?.fecha_emision || null;
  const fSunat = doc.sunat?.fecha_emision || null;
  if (fSap !== fSunat) {
    return [
      crearIncidenciaCompras(
        'ERROR 7',
        'R-CMP-07',
        `Fecha de emisión distinta: SAP (${fSap || 'vacío'}) vs SUNAT (${fSunat || 'vacío'})`,
        { fecha_sap: fSap, fecha_sunat: fSunat }
      ),
    ];
  }
  return [];
}

/**
 * Valida el tipo de documento según las reglas del Error 8:
 *  - Permitidos: 01 (Factura), 07 (Nota de crédito), 09 (Nota de débito).
 *  - Excepción: 14 (Recibos que no migran a SUNAT -> OK).
 */
export function validarTipoDocumentoCompras(doc) {
  const tipoSap = doc.en_sap ? normalizarTipoDocCompras(doc.sap?.tipo_doc_pago ?? doc.tipo_doc_pago) : null;
  const tipoSunat = doc.en_sunat ? normalizarTipoDocCompras(doc.sunat?.tipo_doc_pago ?? doc.tipo_doc_pago) : null;
  const tipoPrincipal = normalizarTipoDocCompras(doc.tipo_doc_pago || tipoSunat || tipoSap);

  const motivos = [];

  if (doc.en_sap && doc.en_sunat && tipoSap !== tipoSunat) {
    motivos.push(`Tipo distinto entre SAP (${tipoSap || 'vacío'}) y SUNAT (${tipoSunat || 'vacío'})`);
  }

  if (tipoSap !== null && !TIPOS_DOC_PERMITIDOS.has(tipoSap)) {
    motivos.push(
      `Tipo en SAP (${descripcionTipoDocCompras(tipoSap)}) no corresponde a las equivalencias válidas (1: Factura, 7: Nota de crédito, 9: Nota de débito; excepción 14)`
    );
  }
  if (tipoSunat !== null && tipoSunat !== tipoSap && !TIPOS_DOC_PERMITIDOS.has(tipoSunat)) {
    motivos.push(
      `Tipo en SUNAT (${descripcionTipoDocCompras(tipoSunat)}) no corresponde a las equivalencias válidas (1: Factura, 7: Nota de crédito, 9: Nota de débito; excepción 14)`
    );
  }
  if (!doc.en_sap && !doc.en_sunat && !TIPOS_DOC_PERMITIDOS.has(tipoPrincipal)) {
    motivos.push(`Tipo de documento (${tipoPrincipal || 'vacío'}) no válido`);
  }

  if (motivos.length > 0) {
    return [
      crearIncidenciaCompras('ERROR 8', 'R-CMP-08', motivos.join(' · '), {
        tipo_sap: tipoSap,
        tipo_sunat: tipoSunat,
      }),
    ];
  }

  return [];
}

/**
 * Valida existencia entre SAP y SUNAT:
 *  - Error 6: Existe en SAP y no existe en SUNAT (EXCEPTO tipo 14 -> OK).
 *  - Obs. 1 : Existe en SUNAT y no existe en SAP.
 */
export function validarExistenciaCompras(doc) {
  const incidencias = [];
  const tipo = normalizarTipoDocCompras(doc.tipo_doc_pago);

  if (doc.en_sap && !doc.en_sunat) {
    if (tipo === TIPO_DOC_EXCEPCION_RECIBO) {
      incidencias.push({
        codigo: 'INFO_TIPO_14',
        tipo: TIPO.INFO,
        descripcion: 'RECIBO TIPO 14 (EXCEPCIÓN SUNAT)',
        detalle: 'Documento tipo 14 (recibo que no migra a SUNAT): considerado OK sin generar Error 6.',
        regla: 'R-CMP-14',
        datos: { tipo_doc_pago: tipo },
      });
    } else {
      incidencias.push(
        crearIncidenciaCompras(
          'ERROR 6',
          'R-CMP-06',
          'El documento está registrado en SAP pero no existe en el archivo TXT de SUNAT.',
          { clave: doc.clave_legible }
        )
      );
    }
  }

  if (!doc.en_sap && doc.en_sunat) {
    incidencias.push(
      crearIncidenciaCompras(
        'OBS 1',
        'R-CMP-OBS1',
        'El documento figura en SUNAT pero no existe en el archivo TXT de SAP.',
        { clave: doc.clave_legible }
      )
    );
  }

  return incidencias;
}

/**
 * Valida observaciones de identidad del proveedor (Obs. 2 y Obs. 3) de manera
 * completamente independiente a los errores económicos.
 */
export function validarIdentidadCompras(doc) {
  if (!doc.en_sap || !doc.en_sunat) return [];
  const incidencias = [];

  const tipoIdSap = normalizarTipoIdentidad(doc.sap?.tipo_identidad);
  const tipoIdSunat = normalizarTipoIdentidad(doc.sunat?.tipo_identidad);

  if (tipoIdSap !== tipoIdSunat) {
    incidencias.push(
      crearIncidenciaCompras(
        'OBS 2',
        'R-CMP-OBS2',
        `Código de tipo de identidad distinto: SAP (${descripcionTipoIdentidadCompras(tipoIdSap)}) vs SUNAT (${descripcionTipoIdentidadCompras(tipoIdSunat)})`,
        { tipo_identidad_sap: tipoIdSap, tipo_identidad_sunat: tipoIdSunat }
      )
    );
  }

  const nroIdSap = String(doc.sap?.nro_identidad ?? '').trim();
  const nroIdSunat = String(doc.sunat?.nro_identidad ?? '').trim();

  if (nroIdSap !== nroIdSunat) {
    incidencias.push(
      crearIncidenciaCompras(
        'OBS 3',
        'R-CMP-OBS3',
        `Número de identidad distinto: SAP (${nroIdSap || 'vacío'}) vs SUNAT (${nroIdSunat || 'vacío'})`,
        { nro_identidad_sap: nroIdSap, nro_identidad_sunat: nroIdSunat }
      )
    );
  }

  return incidencias;
}

/**
 * Clasifica el documento en los 5 resultados oficiales (Sección 6) y en el
 * estado persistible en BD ('OK' | 'OBSERVADO' | 'ERROR').
 */
export function clasificarDocumentoCompras(doc, incidencias) {
  const errores = incidencias.filter((i) => i.tipo === TIPO.ERROR);
  const observaciones = incidencias.filter((i) => i.tipo === TIPO.OBS);
  const tipo = normalizarTipoDocCompras(doc.tipo_doc_pago);

  let resultado = RESULTADOS_COMPRAS.OK.valor;

  if (doc.en_sap && !doc.en_sunat) {
    if (tipo === TIPO_DOC_EXCEPCION_RECIBO && errores.length === 0 && observaciones.length === 0) {
      resultado = RESULTADOS_COMPRAS.OK.valor;
    } else if (errores.some((e) => e.codigo === 'ERROR 6')) {
      resultado = RESULTADOS_COMPRAS.NO_EXISTE_SUNAT.valor;
    } else if (errores.length > 0) {
      resultado = RESULTADOS_COMPRAS.CON_DIFERENCIAS.valor;
    } else if (observaciones.length > 0) {
      resultado = RESULTADOS_COMPRAS.CON_OBSERVACIONES.valor;
    }
  } else if (!doc.en_sap && doc.en_sunat) {
    resultado = RESULTADOS_COMPRAS.NO_EXISTE_SAP.valor;
  } else if (errores.length > 0) {
    resultado = RESULTADOS_COMPRAS.CON_DIFERENCIAS.valor;
  } else if (observaciones.length > 0) {
    resultado = RESULTADOS_COMPRAS.CON_OBSERVACIONES.valor;
  } else {
    resultado = RESULTADOS_COMPRAS.OK.valor;
  }

  // Estado persistible en BD (CHECK constraint: OK | OBSERVADO | ERROR)
  let estado = 'OK';
  if (errores.length > 0) estado = 'ERROR';
  else if (observaciones.length > 0) estado = 'OBSERVADO';

  return { resultado, estado };
}

/** Evalúa todas las reglas del documento acumulando errores y observaciones sin sobrescribir. */
export function validarDocumentoCompras(doc) {
  const incidencias = [
    ...validarExistenciaCompras(doc),
    ...validarTipoDocumentoCompras(doc),
    ...validarFechaEmisionCompras(doc),
    ...validarImportesCompras(doc).incidencias,
    ...validarIdentidadCompras(doc),
  ];

  const { resultado, estado } = clasificarDocumentoCompras(doc, incidencias);
  const errores = incidencias.filter((i) => i.tipo === TIPO.ERROR);
  const observaciones = incidencias.filter((i) => i.tipo === TIPO.OBS);
  const codigosError = [...new Set(errores.map((i) => i.codigo))];
  const codigosObs = [...new Set(observaciones.map((i) => i.codigo))];
  const codigos = [...codigosError, ...codigosObs];

  return { incidencias, resultado, estado, codigos, codigosError, codigosObs };
}
