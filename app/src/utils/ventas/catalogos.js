// ============================================================================
// Catálogos del módulo de Ventas (Hoja "flujo").
// ============================================================================

export const TIPO = { ERROR: 'ERROR', OBS: 'OBS', INFO: 'INFO', META: 'META' };

/**
 * Catálogo de incidencias. Las 11 primeras provienen literalmente de la hoja
 * "flujo". Las marcadas con `complementaria: true` cubren casos que la
 * especificación exige validar pero a los que no asigna código (ver informe).
 */
export const INCIDENCIAS = [
  { codigo: 'ERROR 1', tipo: TIPO.ERROR, descripcion: 'DIFERENCIA EN LA BI GRAVADA', corto: 'Diferencia en la BI Gravada', grupo: 'importes' },
  { codigo: 'ERROR 2', tipo: TIPO.ERROR, descripcion: 'DIFERENCIA EN EL IGV / IPM', corto: 'Diferencia en IGV / IPM', grupo: 'importes' },
  { codigo: 'ERROR 3', tipo: TIPO.ERROR, descripcion: 'DIFERENCIA EN MONTO EXONERADO', corto: 'Diferencia en monto exonerado', grupo: 'importes' },
  { codigo: 'ERROR 4', tipo: TIPO.ERROR, descripcion: 'DIFERENCIA EN MONTO INAFECTO', corto: 'Diferencia en monto inafecto', grupo: 'importes' },
  { codigo: 'ERROR 5', tipo: TIPO.ERROR, descripcion: 'DIFERENCIA EN TOTALES', corto: 'Diferencia en totales', grupo: 'importes' },
  { codigo: 'ERROR 6', tipo: TIPO.ERROR, descripcion: 'BOLETAS MAYORES A 700 SOLES SIN DNI', corto: 'Boletas mayores a 700 soles sin DNI', grupo: 'identidad' },
  { codigo: 'ERROR 7', tipo: TIPO.ERROR, descripcion: 'DIFERENCIA EN OTROS TRIBUTOS', corto: 'Diferencia en otros tributos', grupo: 'importes', complementaria: true },
  { codigo: 'OBS 1', tipo: TIPO.OBS, descripcion: 'DIFERENCIA EN TIPO DE IDENTIDAD', corto: 'Diferencia en tipo de identidad', grupo: 'identidad' },
  { codigo: 'OBS 2', tipo: TIPO.OBS, descripcion: 'DIFERENCIA EN NÚMERO DE IDENTIDAD', corto: 'Diferencia en número de identidad', grupo: 'identidad' },
  { codigo: 'OBS 3', tipo: TIPO.OBS, descripcion: 'DIFERENCIA EN SECUENCIA DE CORRELATIVOS', corto: 'Diferencia en secuencia de correlativos', grupo: 'secuencia' },
  { codigo: 'OBS 4', tipo: TIPO.OBS, descripcion: 'NO EXISTE EN SAP', corto: 'No existe en SAP', grupo: 'existencia' },
  { codigo: 'OBS 5', tipo: TIPO.OBS, descripcion: 'NO EXISTE EN SUNAT', corto: 'No existe en SUNAT', grupo: 'existencia' },
  { codigo: 'OBS 6', tipo: TIPO.OBS, descripcion: 'IDENTIDAD NO CUMPLE REGLAS DE VALIDACIÓN', corto: 'Identidad no cumple reglas (DNI/RUC/CE/Otros/Factura)', grupo: 'identidad', complementaria: true },
];

export const INCIDENCIA_POR_CODIGO = Object.fromEntries(INCIDENCIAS.map((i) => [i.codigo, i]));

export const CODIGOS_IMPORTES = ['ERROR 1', 'ERROR 2', 'ERROR 3', 'ERROR 4', 'ERROR 5', 'ERROR 7'];
export const CODIGOS_IDENTIDAD = ['ERROR 6', 'OBS 1', 'OBS 2', 'OBS 6'];

/** Estados de validación persistidos en BD (CHECK constraint existente). */
export const ESTADOS = {
  OK: { valor: 'OK', etiqueta: 'Correcto', clase: 'ok', color: '#059669' },
  OBSERVADO: { valor: 'OBSERVADO', etiqueta: 'Observación', clase: 'observado', color: '#D97706' },
  ERROR: { valor: 'ERROR', etiqueta: 'Error', clase: 'error', color: '#DC2626' },
};

/** Tabla 10 SUNAT - Tipo de comprobante de pago (hoja flujo, tabla 1). */
export const TIPOS_CP = { '01': 'Factura', '03': 'Boleta de Venta', '07': 'Nota de Crédito', '08': 'Nota de Débito' };
export const descripcionTipoCP = (c) => TIPOS_CP[c] || (c ? `Otro (${c})` : '—');

/** Tabla 2 SUNAT - Tipo de documento de identidad (hoja flujo, tabla 1). */
export const TIPOS_IDENTIDAD = {
  '0': 'Otros (Doc. Trib. No Domiciliado sin RUC)',
  '1': 'DNI',
  '4': 'Carnet de Extranjería',
  '6': 'RUC',
  '7': 'Pasaporte',
};
export const TIPOS_IDENTIDAD_CORTO = { '0': 'Otros', '1': 'DNI', '4': 'CE', '6': 'RUC', '7': 'Pasaporte' };
export const descripcionTipoIdentidad = (t) =>
  t === null || t === undefined || t === '' ? '—' : TIPOS_IDENTIDAD_CORTO[t] ? `${t} - ${TIPOS_IDENTIDAD_CORTO[t]}` : `${t} (no catalogado)`;

/** Importe límite para boletas: S/ 700.00 */
export const LIMITE_BOLETA_CENTIMOS = 70000;

/** Identificadores de reglas para trazabilidad. */
export const REGLAS = {
  'R-DOC-01': 'Identificación por tipo de comprobante + serie + correlativo',
  'R-EXI-01': 'Documento en SUNAT sin registro en SAP',
  'R-EXI-02': 'Documento en SAP sin registro en SUNAT',
  'R-SEC-01': 'Continuidad de correlativos por serie',
  'R-ID-01': 'Boleta con total > S/ 700 debe tener DNI (tipo 1)',
  'R-ID-02': 'Tipo 1 (DNI): número no repetido/genérico y nombre distinto a "CLIENTE"',
  'R-ID-03': 'Boleta con tipo 6 (RUC): debe iniciar con 10',
  'R-ID-04': 'Boleta con tipo 4 (CE): número no repetido/genérico y nombre distinto a "CLIENTE"',
  'R-ID-05': 'Factura: tipo 6 (RUC) iniciando con 20 o 10',
  'R-ID-06': 'Boleta con tipo 0: sin nombre completo y número de dígitos iguales o 0',
  'R-ID-07': 'Tipo de identidad SAP = SUNAT',
  'R-ID-08': 'Número de identidad SAP = SUNAT',
  'R-IMP-01': 'BI Gravada SAP vs SUNAT (tolerancia S/ 0.05)',
  'R-IMP-02': 'IGV / IPM SAP vs SUNAT (tolerancia S/ 0.05)',
  'R-IMP-03': 'Monto exonerado SAP vs SUNAT (tolerancia S/ 0.05)',
  'R-IMP-04': 'Monto inafecto SAP vs SUNAT (tolerancia S/ 0.05)',
  'R-IMP-05': 'Importe total SAP vs SUNAT (tolerancia S/ 0.05)',
  'R-IMP-06': 'Otros tributos SAP vs SUNAT (tolerancia S/ 0.05)',
  'R-COR-01': 'Cortesía: BI/IGV/otros con importe y total = 0 en SAP y SUNAT',
  'R-ANU-01': 'Comprobante anulado (estado 2): reglas de identidad no aplicables',
};
