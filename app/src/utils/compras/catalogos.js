// ============================================================================
// Catálogos del módulo de Compras (Conciliación SAP vs SUNAT — RCE).
// Define las 8 categorías de errores, las 3 observaciones, los 5 resultados
// de clasificación, equivalencias de tipo de documento y trazabilidad de reglas.
// ============================================================================

export const TIPO = { ERROR: 'ERROR', OBS: 'OBS', INFO: 'INFO', META: 'META' };

/**
 * Catálogo oficial de 8 errores y 3 observaciones del módulo de Compras.
 * Los errores y las observaciones son independientes y acumulables.
 */
export const INCIDENCIAS_COMPRAS = [
  { codigo: 'ERROR 1', tipo: TIPO.ERROR, descripcion: 'Error en BASE', corto: 'Error en BASE', grupo: 'importes', campo: 'base' },
  { codigo: 'ERROR 2', tipo: TIPO.ERROR, descripcion: 'Error en IGV', corto: 'Error en IGV', grupo: 'importes', campo: 'igv' },
  { codigo: 'ERROR 3', tipo: TIPO.ERROR, descripcion: 'Error en VALOR DE ADQUISICIÓN', corto: 'Error en Valor de Adquisición', grupo: 'importes', campo: 'valor_adquisicion' },
  { codigo: 'ERROR 4', tipo: TIPO.ERROR, descripcion: 'Error en OTROS TRIBUTOS / CARGOS', corto: 'Error en Otros Trib. / Cargos', grupo: 'importes', campo: 'otros' },
  { codigo: 'ERROR 5', tipo: TIPO.ERROR, descripcion: 'Error en MONTOS TOTALES', corto: 'Error en Montos Totales', grupo: 'importes', campo: 'total' },
  { codigo: 'ERROR 6', tipo: TIPO.ERROR, descripcion: 'Documento NO EXISTE EN SUNAT', corto: 'No existe en SUNAT', grupo: 'existencia' },
  { codigo: 'ERROR 7', tipo: TIPO.ERROR, descripcion: 'Error en FECHA DE EMISIÓN', corto: 'Error en Fecha de Emisión', grupo: 'fecha' },
  { codigo: 'ERROR 8', tipo: TIPO.ERROR, descripcion: 'Tipo de documento incorrecto', corto: 'Tipo de documento incorrecto', grupo: 'documento' },
  { codigo: 'OBS 1', tipo: TIPO.OBS, descripcion: 'Documento NO EXISTE EN SAP', corto: 'No existe en SAP', grupo: 'existencia' },
  { codigo: 'OBS 2', tipo: TIPO.OBS, descripcion: 'Los códigos de tipo de identidad deben ser iguales', corto: 'Tipo de identidad diferente', grupo: 'identidad' },
  { codigo: 'OBS 3', tipo: TIPO.OBS, descripcion: 'Los números de tipo de identidad deben ser iguales', corto: 'Número de identidad diferente', grupo: 'identidad' },
];

export const ERRORES_COMPRAS = INCIDENCIAS_COMPRAS.filter((i) => i.tipo === TIPO.ERROR);
export const OBSERVACIONES_COMPRAS = INCIDENCIAS_COMPRAS.filter((i) => i.tipo === TIPO.OBS);

export const INCIDENCIA_COMPRAS_POR_CODIGO = Object.fromEntries(
  INCIDENCIAS_COMPRAS.map((i) => [i.codigo, i])
);

export const CODIGOS_IMPORTES_COMPRAS = ['ERROR 1', 'ERROR 2', 'ERROR 3', 'ERROR 4', 'ERROR 5'];

/**
 * Clasificación detallada de resultados (5 estados del módulo de Compras).
 * Se mapea a `estado_validacion` de BD ('OK' | 'OBSERVADO' | 'ERROR') sin
 * romper las restricciones CHECK ni las vistas existentes.
 */
export const RESULTADOS_COMPRAS = {
  OK: {
    valor: 'OK',
    etiqueta: 'OK',
    etiquetaLarga: 'OK',
    estadoBD: 'OK',
    clase: 'ok',
    color: '#059669',
    bg: 'rgba(5, 150, 105, 0.1)',
  },
  CON_DIFERENCIAS: {
    valor: 'CON_DIFERENCIAS',
    etiqueta: 'CON DIFERENCIAS',
    etiquetaLarga: 'Con Diferencias',
    estadoBD: 'ERROR',
    clase: 'error',
    color: '#DC2626',
    bg: 'rgba(220, 38, 38, 0.1)',
  },
  CON_OBSERVACIONES: {
    valor: 'CON_OBSERVACIONES',
    etiqueta: 'CON OBSERVACIONES',
    etiquetaLarga: 'Con Observaciones',
    estadoBD: 'OBSERVADO',
    clase: 'observado',
    color: '#D97706',
    bg: 'rgba(217, 119, 6, 0.1)',
  },
  NO_EXISTE_SUNAT: {
    valor: 'NO_EXISTE_SUNAT',
    etiqueta: 'NO EXISTE EN SUNAT',
    etiquetaLarga: 'No Existe en SUNAT',
    estadoBD: 'ERROR',
    clase: 'error',
    color: '#B91C1C',
    bg: 'rgba(185, 28, 28, 0.1)',
  },
  NO_EXISTE_SAP: {
    valor: 'NO_EXISTE_SAP',
    etiqueta: 'NO EXISTE EN SAP',
    etiquetaLarga: 'No Existe en SAP',
    estadoBD: 'OBSERVADO',
    clase: 'observado',
    color: '#B45309',
    bg: 'rgba(180, 83, 9, 0.1)',
  },
};

export const LISTA_RESULTADOS_COMPRAS = [
  RESULTADOS_COMPRAS.OK,
  RESULTADOS_COMPRAS.CON_DIFERENCIAS,
  RESULTADOS_COMPRAS.CON_OBSERVACIONES,
  RESULTADOS_COMPRAS.NO_EXISTE_SUNAT,
  RESULTADOS_COMPRAS.NO_EXISTE_SAP,
];

/**
 * Reglas específicas del Error 8 (equivalencias permitidas + excepción tipo 14):
 *  - 01 (1): Factura
 *  - 07 (7): Nota de crédito
 *  - 08 (8): Nota de débito (código oficial SUNAT Tabla 10)
 *  - 09 (9): Nota de débito (equivalencia SAP)
 *  - 14    : Recibos que no migran a SUNAT (excepción -> OK)
 */
export const TIPOS_DOC_PERMITIDOS = new Set(['01', '07', '08', '09', '14']);
export const TIPO_DOC_EXCEPCION_RECIBO = '14';

export const TIPOS_DOC_COMPRAS = {
  '01': 'Factura',
  '02': 'Recibo por Honorarios',
  '03': 'Boleta de Venta',
  '04': 'Liquidación de Compra',
  '05': 'Boleto Aéreo',
  '07': 'Nota de Crédito',
  '08': 'Nota de Débito (SUNAT 08)',
  '09': 'Nota de Débito',
  '10': 'Recibo por Arrendamiento',
  '12': 'Ticket o Cinta de Máquina Registradora',
  '14': 'Recibo de Servicios Públicos (Tipo 14)',
  '30': 'Adquisición No Domiciliados',
  '50': 'DUA / DAM',
  '91': 'Comprobante No Domiciliado',
  '97': 'Nota de Crédito Especial',
  '98': 'Nota de Débito Especial',
};

export const descripcionTipoDocCompras = (codigo) => {
  if (!codigo) return '—';
  const norm = String(codigo).trim();
  const padded = /^\d$/.test(norm) ? `0${norm}` : norm;
  return TIPOS_DOC_COMPRAS[padded]
    ? `${padded} - ${TIPOS_DOC_COMPRAS[padded]}`
    : `${padded} - Otro (${padded})`;
};

export const TIPOS_IDENTIDAD_COMPRAS = {
  '0': 'Otros',
  '1': 'DNI',
  '4': 'CE',
  '6': 'RUC',
  '7': 'Pasaporte',
  'A': 'Cédula Diplomática',
};

export const descripcionTipoIdentidadCompras = (t) => {
  if (t === null || t === undefined || t === '') return '—';
  const clean = String(t).trim();
  return TIPOS_IDENTIDAD_COMPRAS[clean]
    ? `${clean} - ${TIPOS_IDENTIDAD_COMPRAS[clean]}`
    : clean;
};

/** Conceptos monetarios comparados en Compras (Errores 1 al 5). */
export const CONCEPTOS_IMPORTE_COMPRAS = [
  { campo: 'base', codigo: 'ERROR 1', concepto: 'Base Imponible', regla: 'R-CMP-01' },
  { campo: 'igv', codigo: 'ERROR 2', concepto: 'IGV', regla: 'R-CMP-02' },
  { campo: 'valor_adquisicion', codigo: 'ERROR 3', concepto: 'Valor de Adquisición', regla: 'R-CMP-03' },
  { campo: 'otros', codigo: 'ERROR 4', concepto: 'Otros Tributos / Cargos', regla: 'R-CMP-04' },
  { campo: 'total', codigo: 'ERROR 5', concepto: 'Monto Total', regla: 'R-CMP-05' },
];

/** Reglas de trazabilidad del módulo de Compras. */
export const REGLAS_COMPRAS = {
  'R-CMP-KEY': 'Clave única: RUC Proveedor + Tipo de Documento + Serie + Correlativo',
  'R-CMP-01': 'Comparación exacta de Base Imponible (SAP vs SUNAT)',
  'R-CMP-02': 'Comparación exacta de IGV (SAP vs SUNAT)',
  'R-CMP-03': 'Comparación exacta de Valor de Adquisición (SAP vs SUNAT)',
  'R-CMP-04': 'Comparación exacta de Otros Tributos / Cargos (SAP vs SUNAT)',
  'R-CMP-05': 'Comparación exacta de Montos Totales (SAP vs SUNAT)',
  'R-CMP-06': 'Documento registrado en SAP debe existir en SUNAT (excepto tipo 14)',
  'R-CMP-07': 'Fecha de emisión SAP debe coincidir exactamente con SUNAT',
  'R-CMP-08': 'Tipo de documento debe ser 1 (Factura), 7 (Nota de crédito), 9 (Nota de débito) o excepción 14',
  'R-CMP-14': 'Excepción Tipo 14: Recibos que no migran a SUNAT se consideran OK',
  'R-CMP-OBS1': 'Documento encontrado en SUNAT sin correspondencia en SAP',
  'R-CMP-OBS2': 'Código de tipo de identidad del proveedor debe coincidir entre SAP y SUNAT',
  'R-CMP-OBS3': 'Número de identidad del proveedor debe coincidir entre SAP y SUNAT',
};
