// ============================================================================
// Suite de verificación integral del módulo de Compras (SAP vs. SUNAT — RCE).
// Prueba con archivos TXT reales/simulados de SAP (PLE 8.1) y SUNAT (SIRE RCE):
//  - Clave única (RUC + Tipo Doc + Serie + Correlativo) preservando ceros
//  - Detección de los 8 errores (ERROR 1 a ERROR 8)
//  - Excepción Tipo 14 = OK (no genera ERROR 6 ni ERROR 8)
//  - Detección de las 3 observaciones (OBS 1 a OBS 3) independientes de errores
//  - Acumulación de múltiples incidencias sin sobrescribir
//  - Detección de duplicados en archivos de origen sin duplicar resultados
//  - Precisión decimal exacta en comparaciones monetarias
//  - Ida y vuelta de persistencia en detalle_compras (`aFilaBDCompras`/`desdeFilaBDCompras`)
//  - Indicadores (7 tarjetas), filtros, exportación Excel (8 hojas) y Web Worker
// ============================================================================
import assert from 'assert';
import {
  construirClaveCompras,
  construirClaveLegible,
  construirCarBDCompras,
} from './src/utils/compras/documento.js';
import {
  decodificarTexto,
  parsearSapCompras,
  parsearSunatCompras,
  parsearUsuariosSapCompras,
} from './src/utils/compras/lectores.js';
import { conciliarCompras, enriquecerComprasConUsuariosSap } from './src/utils/compras/motor.js';
import { validarDocumentoCompras } from './src/utils/compras/reglas.js';
import { aFilaBDCompras, desdeFilaBDCompras } from './src/utils/compras/persistencia.js';
import {
  FILTROS_INICIALES_COMPRAS,
  filtrarDocumentosCompras,
  calcularIndicadoresCompras,
  construirDatosExcelCompras,
  obtenerDocsSapParaCopiar,
} from './src/utils/compras/reportes.js';
import { runCpuTaskInWorker } from './src/utils/jobQueue.js';

console.log('=== PRUEBAS DEL MÓDULO DE COMPRAS (SAP vs. SUNAT) ===');

// Helper para construir una línea TXT SAP Compras (PLE 8.1 — 25 columnas delimitadas por "|")
function lineaSap({
  periodo = '20260600',
  cuo = 'CUO001',
  asiento = 'M001',
  fecha = '15/06/2026',
  vcto = '',
  tipo = '01',
  serie = 'F001',
  anio = '',
  corr = '00001234',
  nroFinal = '',
  tipoId = '6',
  ruc = '20100047218',
  nombre = 'PROVEEDOR DEMO SAC',
  base = '100.00',
  igv = '18.00',
  biDgng = '0.00',
  igvDgng = '0.00',
  biDng = '0.00',
  igvDng = '0.00',
  valorAdq = '0.00',
  isc = '0.00',
  icbper = '0.00',
  otros = '0.00',
  total = '118.00',
}) {
  return [
    periodo, cuo, asiento, fecha, vcto, tipo, serie, anio, corr, nroFinal,
    tipoId, ruc, nombre, base, igv, biDgng, igvDgng, biDng, igvDng, valorAdq,
    isc, icbper, otros, total, 'PEN',
  ].join('|');
}

// Helper para construir una línea TXT SUNAT Compras (SIRE RCE — con cabecera)
const CABECERA_SUNAT_COMPRAS = [
  'Ruc', 'Apellidos y Nombres o Razón Social', 'Periodo', 'CAR SUNAT',
  'Fecha de emisión', 'Fecha Vcto/Pago', 'Tipo CP/Doc.', 'Serie del CDP',
  'Año', 'Nro CP o Doc. Nro Inicial (Rango)', 'Nro Final (Rango)',
  'Tipo Doc Identidad', 'Nro Doc Identidad', 'Apellidos Nombres/ Razón  Social',
  'BI Gravado DG', 'IGV / IPM DG', 'BI Gravado DGNG', 'IGV / IPM DGNG',
  'BI Gravado DNG', 'IGV / IPM DNG', 'Valor Adq. NG', 'ISC', 'ICBPER',
  'Otros Trib/ Cargos', 'Total CP', 'Moneda',
].join('|');

function lineaSunat({
  rucEmpresa = '20553596441',
  razonEmpresa = 'CHIFAS DEL PERU SAC',
  periodo = '202606',
  car = '',
  fecha = '15/06/2026',
  vcto = '',
  tipo = '01',
  serie = 'F001',
  anio = '',
  corr = '00001234',
  nroFinal = '',
  tipoId = '6',
  ruc = '20100047218',
  nombre = 'PROVEEDOR DEMO SAC',
  base = '100.00',
  igv = '18.00',
  biDgng = '0.00',
  igvDgng = '0.00',
  biDng = '0.00',
  igvDng = '0.00',
  valorAdq = '0.00',
  isc = '0.00',
  icbper = '0.00',
  otros = '0.00',
  total = '118.00',
}) {
  return [
    rucEmpresa, razonEmpresa, periodo, car, fecha, vcto, tipo, serie, anio,
    corr, nroFinal, tipoId, ruc, nombre, base, igv, biDgng, igvDgng, biDng,
    igvDng, valorAdq, isc, icbper, otros, total, 'PEN',
  ].join('|');
}

// 1. Clave única y preservación de ceros a la izquierda
{
  const k1 = construirClaveCompras(' 20100047218 ', '1', ' 0001 ', '00001234');
  const k2 = construirClaveCompras('20100047218', '01', '0001', '1234');
  assert.strictEqual(k1, k2, 'La clave estandarizada debe emparejar "1"/"01" y "00001234"/"1234" preservando serie "0001"');

  const kSerieDiferente = construirClaveCompras('20100047218', '01', '001', '00001234');
  assert.notStrictEqual(k1, kSerieDiferente, 'Serie "0001" y "001" no deben perder sus ceros a la izquierda');

  const legible = construirClaveLegible('20100047218', '01', '0001', '00001234');
  assert.strictEqual(legible, '20100047218-01-0001-00001234', 'Clave legible debe preservar ceros a la izquierda');

  const carLargo = construirCarBDCompras('EXTRANJERO12345678', '01', 'SERIE001', '000000012345');
  assert.ok(carLargo.length <= 30, 'car_sunat para BD nunca debe superar VARCHAR(30)');
}

// 2. Prueba integral con TXT completos de SAP y SUNAT cubriendo TODOS los errores y observaciones
{
  const sapTxt = [
    // Doc 1: OK (Factura tipo 1 -> 01, ceros en serie 0001 y correlativo 00000045; SUNAT viene con "45")
    lineaSap({ cuo: '1900014801', ruc: '20100047218', tipo: '1', serie: '0001', corr: '00000045', fecha: '02/06/2026', base: '200.00', igv: '36.00', valorAdq: '10.00', otros: '4.00', total: '250.00', nombre: 'PROVEEDOR OK SAC' }),
    // Duplicado intencional del Doc 1 en SAP (debe ser detectado como duplicado y no duplicar filas en resultados)
    lineaSap({ cuo: '1900014801', ruc: '20100047218', tipo: '01', serie: '0001', corr: '00000045', fecha: '02/06/2026', base: '200.00', igv: '36.00', valorAdq: '10.00', otros: '4.00', total: '250.00', nombre: 'PROVEEDOR OK SAC' }),
    // Doc 2: Nota de Crédito (tipo 7 -> 07) OK
    lineaSap({ cuo: '1900014802', ruc: '20100047218', tipo: '07', serie: 'FC01', corr: '00000010', fecha: '05/06/2026', base: '-50.00', igv: '-9.00', total: '-59.00', nombre: 'PROVEEDOR OK SAC' }),
    // Doc 3: Nota de Débito (tipo 9 -> 09) OK
    lineaSap({ cuo: '1900014803', ruc: '20100047218', tipo: '9', serie: 'FD01', corr: '00000002', fecha: '06/06/2026', base: '10.00', igv: '1.80', total: '11.80', nombre: 'PROVEEDOR OK SAC' }),
    // Doc 4: Tipo 14 (Recibo servicios públicos) SOLO EN SAP -> Excepción: debe ser OK (SIN ERROR 6 ni ERROR 8)
    lineaSap({ cuo: '1900014804', ruc: '20100017491', tipo: '14', serie: 'S001', corr: '00998877', fecha: '07/06/2026', base: '300.00', igv: '54.00', total: '354.00', nombre: 'TELEFONICA DEL PERU SAA' }),
    // Doc 5: Acumulación múltiple -> ERROR 1 (Base), ERROR 2 (IGV), ERROR 3 (Valor Adq), ERROR 4 (Otros), ERROR 5 (Total), ERROR 7 (Fecha) y OBS 2 (Tipo ID distinto)
    lineaSap({ cuo: '1900014518', ruc: '20222222222', tipo: '01', serie: 'F002', corr: '00000100', fecha: '10/06/2026', tipoId: '1', base: '100.01', igv: '18.02', valorAdq: '5.50', otros: '2.00', total: '125.53', nombre: 'PROVEEDOR DIFERENCIAS SAC' }),
    // Doc 6: NO EXISTE EN SUNAT (ERROR 6)
    lineaSap({ cuo: '1900014519', ruc: '20333333333', tipo: '01', serie: 'F003', corr: '00000200', fecha: '11/06/2026', base: '500.00', igv: '90.00', total: '590.00', nombre: 'PROVEEDOR SOLO SAP EIRL' }),
    // Doc 7: Tipo de documento incorrecto (03 Boleta -> ERROR 8) presente en ambos
    lineaSap({ cuo: '001900014520', ruc: '20444444444', tipo: '03', serie: 'B001', corr: '00000300', fecha: '12/06/2026', base: '80.00', igv: '14.40', total: '94.40', nombre: 'PROVEEDOR BOLETA SAC' }),
    // Doc 8: CON OBSERVACIONES únicamente (OBS 2: tipo identidad SAP=4 vs SUNAT=6, importes y fecha OK)
    lineaSap({ cuo: '1900014521', ruc: '20555555555', tipo: '01', serie: 'F005', corr: '00000400', fecha: '13/06/2026', tipoId: '4', base: '100.00', igv: '18.00', total: '118.00', nombre: 'PROVEEDOR OBS ID SAC' }),
  ].join('\n');

  const sunatTxt = [
    CABECERA_SUNAT_COMPRAS,
    // Doc 1: coincide con SAP (correlativo sin ceros "45", SAP tenía "00000045")
    lineaSunat({ ruc: '20100047218', tipo: '01', serie: '0001', corr: '45', fecha: '02/06/2026', base: '200.00', igv: '36.00', valorAdq: '10.00', otros: '4.00', total: '250.00', nombre: 'PROVEEDOR OK SAC' }),
    // Doc 2: NC OK
    lineaSunat({ ruc: '20100047218', tipo: '07', serie: 'FC01', corr: '00000010', fecha: '05/06/2026', base: '-50.00', igv: '-9.00', total: '-59.00', nombre: 'PROVEEDOR OK SAC' }),
    // Doc 3: ND tipo 09 OK
    lineaSunat({ ruc: '20100047218', tipo: '09', serie: 'FD01', corr: '00000002', fecha: '06/06/2026', base: '10.00', igv: '1.80', total: '11.80', nombre: 'PROVEEDOR OK SAC' }),
    // Doc 5: diferencias en los 5 montos (incluso S/ 0.01 exacto!), fecha distinta (11/06 vs 10/06) y tipoId distinto (6 vs 1)
    lineaSunat({ ruc: '20222222222', tipo: '01', serie: 'F002', corr: '00000100', fecha: '11/06/2026', tipoId: '6', base: '100.00', igv: '18.00', valorAdq: '5.00', otros: '1.50', total: '124.50', nombre: 'PROVEEDOR DIFERENCIAS SAC' }),
    // Doc 7: Tipo 03 en ambos -> ERROR 8
    lineaSunat({ ruc: '20444444444', tipo: '03', serie: 'B001', corr: '00000300', fecha: '12/06/2026', base: '80.00', igv: '14.40', total: '94.40', nombre: 'PROVEEDOR BOLETA SAC' }),
    // Doc 8: OBS 2 únicamente
    lineaSunat({ ruc: '20555555555', tipo: '01', serie: 'F005', corr: '00000400', fecha: '13/06/2026', tipoId: '6', base: '100.00', igv: '18.00', total: '118.00', nombre: 'PROVEEDOR OBS ID SAC' }),
    // Doc 9: NO EXISTE EN SAP (OBS 1)
    lineaSunat({ ruc: '20666666666', tipo: '01', serie: 'F009', corr: '00000999', fecha: '14/06/2026', base: '400.00', igv: '72.00', total: '472.00', nombre: 'PROVEEDOR SOLO SUNAT SAC' }),
  ].join('\n');

  const resSap = parsearSapCompras(sapTxt);
  const resSunat = parsearSunatCompras(sunatTxt);

  assert.strictEqual(resSap.periodoDetectado, '202606');
  assert.strictEqual(resSunat.periodoDetectado, '202606');
  assert.strictEqual(resSunat.rucDetectado, '20553596441');
  assert.strictEqual(resSap.duplicados.length, 1, 'Debe detectar 1 clave duplicada en SAP origen');
  assert.deepStrictEqual(resSap.duplicados[0].lineas, [1, 2], 'Debe reportar las líneas exactas del duplicado');
  assert.strictEqual(resSap.registrosValidos, 8, 'SAP debe entregar 8 registros únicos');
  assert.strictEqual(resSunat.registrosValidos, 7, 'SUNAT debe entregar 7 registros únicos');

  const { docs } = conciliarCompras({ sap: resSap.registros, sunat: resSunat.registros });
  assert.strictEqual(docs.length, 9, 'Universo único SAP ∪ SUNAT debe ser 9 documentos sin duplicidades');

  const buscar = (serie, ruc) => docs.find((d) => d.serie === serie && d.ruc_proveedor === ruc);

  // Doc 1: OK y preserva ceros a la izquierda de SAP ("00000045") y serie ("0001")
  const d1 = buscar('0001', '20100047218');
  assert.strictEqual(d1.resultado, 'OK');
  assert.strictEqual(d1.correlativo, '00000045', 'Debe preservar ceros a la izquierda en correlativo');
  assert.strictEqual(d1.serie, '0001', 'Debe preservar ceros a la izquierda en serie');
  assert.strictEqual(d1.sap.duplicado_en_origen, true, 'Debe conservar trazabilidad de duplicado en origen');

  // Doc 2 y Doc 3: tipos 07 y 09 OK
  assert.strictEqual(buscar('FC01', '20100047218').resultado, 'OK');
  assert.strictEqual(buscar('FD01', '20100047218').resultado, 'OK');

  // Doc 4: Tipo 14 solo en SAP -> OK (excepción)
  const d14 = buscar('S001', '20100017491');
  assert.strictEqual(d14.resultado, 'OK', 'Tipo 14 ausente en SUNAT debe clasificarse como OK');
  assert.strictEqual(d14.estado, 'OK');
  assert.strictEqual(d14.codigos.length, 0, 'Tipo 14 no debe generar ERROR 6 ni ERROR 8');

  // Doc 5: Acumula ERROR 1, 2, 3, 4, 5, 7 y OBS 2 simultáneamente sin sobrescribir
  const d5 = buscar('F002', '20222222222');
  assert.strictEqual(d5.resultado, 'CON_DIFERENCIAS');
  assert.strictEqual(d5.estado, 'ERROR');
  for (const cod of ['ERROR 1', 'ERROR 2', 'ERROR 3', 'ERROR 4', 'ERROR 5', 'ERROR 7']) {
    assert.ok(d5.codigosError.includes(cod), `Doc 5 debe detectar ${cod}`);
  }
  assert.ok(d5.codigosObs.includes('OBS 2'), 'Doc 5 debe acumular OBS 2 junto con los errores económicos');

  // Doc 6: NO EXISTE EN SUNAT (ERROR 6)
  const d6 = buscar('F003', '20333333333');
  assert.strictEqual(d6.resultado, 'NO_EXISTE_SUNAT');
  assert.deepStrictEqual(d6.codigosError, ['ERROR 6']);

  // Doc 7: Tipo 03 -> ERROR 8
  const d7 = buscar('B001', '20444444444');
  assert.strictEqual(d7.resultado, 'CON_DIFERENCIAS');
  assert.deepStrictEqual(d7.codigosError, ['ERROR 8']);

  // Doc 8: Solo OBS 2 -> CON_OBSERVACIONES
  const d8 = buscar('F005', '20555555555');
  assert.strictEqual(d8.resultado, 'CON_OBSERVACIONES');
  assert.strictEqual(d8.estado, 'OBSERVADO');
  assert.deepStrictEqual(d8.codigosObs, ['OBS 2']);

  // Doc 9: NO EXISTE EN SAP (OBS 1)
  const d9 = buscar('F009', '20666666666');
  assert.strictEqual(d9.resultado, 'NO_EXISTE_SAP');
  assert.strictEqual(d9.estado, 'OBSERVADO');
  assert.deepStrictEqual(d9.codigosObs, ['OBS 1']);

  // 3. Validar OBS 3 explícitamente (números de identidad diferentes en documento coincidente)
  const docObs3 = {
    en_sap: true,
    en_sunat: true,
    tipo_doc_pago: '01',
    clave_legible: '20100047218-01-F001-0001',
    sap: { tipo_doc_pago: '01', fecha_emision: '2026-06-15', tipo_identidad: '6', nro_identidad: '20100047218', base: 10000, igv: 1800, valor_adquisicion: 0, otros: 0, total: 11800 },
    sunat: { tipo_doc_pago: '01', fecha_emision: '2026-06-15', tipo_identidad: '6', nro_identidad: '20100047219', base: 10000, igv: 1800, valor_adquisicion: 0, otros: 0, total: 11800 },
  };
  const valObs3 = validarDocumentoCompras(docObs3);
  assert.ok(valObs3.codigosObs.includes('OBS 3'), 'Debe detectar OBS 3 cuando difieren los números de identidad');
  assert.strictEqual(valObs3.resultado, 'CON_OBSERVACIONES');

  // 4. Verificar los 7 Indicadores y el invariante de partición completa
  const ind = calcularIndicadoresCompras(docs);
  assert.strictEqual(ind.totalSap, 8);
  assert.strictEqual(ind.totalSunat, 7);
  assert.strictEqual(ind.ok, 4, 'Docs OK: Doc1, Doc2, Doc3 y Doc4 (Tipo 14)');
  assert.strictEqual(ind.tipo14Ok, 1);
  assert.strictEqual(ind.conDiferencias, 2, 'Docs Con Diferencias: Doc5 y Doc7');
  assert.strictEqual(ind.conObservaciones, 1, 'Docs Con Observaciones: Doc8');
  assert.strictEqual(ind.noExisteSunat, 1, 'No existen en SUNAT: Doc6');
  assert.strictEqual(ind.noExisteSap, 1, 'No existen en SAP: Doc9');
  assert.strictEqual(
    ind.ok + ind.conDiferencias + ind.conObservaciones + ind.noExisteSunat + ind.noExisteSap,
    ind.totalUnicos,
    'La suma de las 5 clasificaciones debe ser igual al total de documentos únicos'
  );

  // 5. Verificar ida y vuelta de persistencia (detalle_compras)
  for (const d of docs) {
    const fila = aFilaBDCompras(d, { periodoId: 'p-1', empresaId: 'e-1' });
    assert.ok(fila.car_sunat.length <= 30, 'car_sunat <= 30 chars');
    assert.ok(['OK', 'OBSERVADO', 'ERROR'].includes(fila.estado_validacion), 'estado_validacion válido para CHECK BD');
    const rec = desdeFilaBDCompras({ ...fila, id: `id-${d.serie}` });
    assert.strictEqual(rec.resultado, d.resultado, `Resultado persistido debe coincidir para ${d.serie}`);
    assert.deepStrictEqual(rec.codigosError, d.codigosError, `Errores persistidos deben coincidir para ${d.serie}`);
    assert.deepStrictEqual(rec.codigosObs, d.codigosObs, `Obs persistidas deben coincidir para ${d.serie}`);
    assert.strictEqual(rec.correlativo, d.correlativo, `Correlativo con ceros debe preservarse para ${d.serie}`);
    if (d.en_sap) assert.strictEqual(rec.sap.fecha_emision, d.sap.fecha_emision);
    if (d.en_sunat) assert.strictEqual(rec.sunat.fecha_emision, d.sunat.fecha_emision);
  }

  // 6. Verificar filtros (estado, error, obs, RUC, razón social, tipo doc, serie, fechas)
  assert.strictEqual(filtrarDocumentosCompras(docs, { ...FILTROS_INICIALES_COMPRAS, resultado: 'OK' }).length, 4);
  assert.strictEqual(filtrarDocumentosCompras(docs, { ...FILTROS_INICIALES_COMPRAS, tipoError: 'ERROR 7' }).length, 1);
  assert.strictEqual(filtrarDocumentosCompras(docs, { ...FILTROS_INICIALES_COMPRAS, tipoObs: 'OBS 2' }).length, 2);
  assert.strictEqual(filtrarDocumentosCompras(docs, { ...FILTROS_INICIALES_COMPRAS, ruc: '20100017491' }).length, 1);
  assert.strictEqual(filtrarDocumentosCompras(docs, { ...FILTROS_INICIALES_COMPRAS, razonSocial: 'telefonica' }).length, 1);
  assert.strictEqual(filtrarDocumentosCompras(docs, { ...FILTROS_INICIALES_COMPRAS, tipoDoc: '14' }).length, 1);
  assert.strictEqual(filtrarDocumentosCompras(docs, { ...FILTROS_INICIALES_COMPRAS, serie: 'F002' }).length, 1);
  assert.strictEqual(filtrarDocumentosCompras(docs, { ...FILTROS_INICIALES_COMPRAS, fechaDesde: '2026-06-14', fechaHasta: '2026-06-14' }).length, 1);

  // 7. Verificar estructura de exportación Excel (todas las hojas requeridas)
  const hojas = construirDatosExcelCompras(docs);
  for (const nombreHoja of [
    'Resumen General',
    'Documentos OK',
    'Con Diferencias',
    'Con Observaciones',
    'No Existen en SUNAT',
    'No Existen en SAP',
    'Detalle de Errores',
    'Conciliacion Completa',
  ]) {
    assert.ok(Array.isArray(hojas[nombreHoja]), `Debe generarse la hoja "${nombreHoja}"`);
  }
  assert.strictEqual(hojas['Documentos OK'].length, 4);
  assert.strictEqual(hojas['Con Diferencias'].length, 2);
  assert.strictEqual(hojas['No Existen en SUNAT'].length, 1);
  assert.strictEqual(hojas['No Existen en SAP'].length, 1);
  assert.ok(hojas['Detalle de Errores'].length >= 10, 'Detalle de Errores debe listar cada error/obs por documento');

  // 8. Verificar integración con Worker fallback (PARSE_SAP_COMPRAS, PARSE_SUNAT_COMPRAS, CONCILIAR_COMPRAS_V2)
  const enc = new TextEncoder();
  const sapBuf = enc.encode(sapTxt).buffer;
  const sunatBuf = enc.encode('\uFEFF' + sunatTxt).buffer; // con BOM UTF-8
  const decTest = decodificarTexto(sunatBuf);
  assert.ok(!decTest.texto.startsWith('\uFEFF') && decTest.texto.startsWith('Ruc|'), 'Debe remover BOM UTF-8 limpiamente');

  const wSap = await runCpuTaskInWorker('PARSE_SAP_COMPRAS', { buffer: sapBuf });
  const wSunat = await runCpuTaskInWorker('PARSE_SUNAT_COMPRAS', { buffer: sunatBuf });
  const wConc = await runCpuTaskInWorker('CONCILIAR_COMPRAS_V2', { sap: wSap.registros, sunat: wSunat.registros });
  assert.strictEqual(wConc.docs.length, 9, 'Worker CONCILIAR_COMPRAS_V2 debe devolver los 9 documentos conciliados');

  // 9. Verificar rechazo de archivo cruzado (SUNAT en casilla SAP y SAP en casilla SUNAT)
  const sapConSunat = parsearSapCompras(sunatTxt);
  assert.strictEqual(sapConSunat.estado, 'error', 'Debe rechazar TXT SUNAT cargado en casilla SAP');
  const sunatConSap = parsearSunatCompras(sapTxt);
  assert.strictEqual(sunatConSap.estado, 'error', 'Debe rechazar TXT SAP cargado en casilla SUNAT');

  // 10. Verificar N° de documento SAP, copiado total con error (ignorando paginación) y cruce con Excel de Usuarios SAP
  assert.strictEqual(d1.nro_doc_sap, '1900014801', 'Debe exponer N° documento SAP del campo 2 del TXT');
  assert.strictEqual(d5.sap.doc_interno, '1900014518');

  // Copiado de TODOS los N° doc SAP con error (Doc 5, Doc 6 y Doc 7 -> 3 docs; excluye OK y OBS 1/OBS 2)
  const copiaErrores = obtenerDocsSapParaCopiar(docs, { soloConError: true });
  assert.strictEqual(copiaErrores.total, 3, 'Debe extraer exactamente los 3 N° doc SAP con error');
  assert.deepStrictEqual(copiaErrores.lista, ['1900014518', '1900014519', '001900014520']);
  assert.strictEqual(copiaErrores.texto, '1900014518\n1900014519\n001900014520');

  // Copiado de todos los N° doc SAP (8 docs con SAP, excluyendo Doc 9 que solo existe en SUNAT)
  const copiaTodos = obtenerDocsSapParaCopiar(docs, { soloConError: false });
  assert.strictEqual(copiaTodos.total, 8, 'Debe extraer los 8 N° doc SAP totales');

  // Parseo de Excel de Usuarios SAP con las cabeceras exactas de SAP BKPF (Imagen 2)
  const filasExcelSap = [
    {
      Sociedad: '1013',
      'Nº documento': '1900014518',
      Referencia: '01-0F002-00000100',
      Ejercicio: '2026',
      'Fecha de documento': '10/06/2026',
      'Fe.contabilización': '11/06/2026',
      'Nombre del usuario': 'ASIS-CON-04',
      'Código transacción': 'MIRO',
      'Texto cab.documento': 'PROVEEDOR DIFERENCIAS',
    },
    {
      Sociedad: '1013',
      'Nº documento': '1900014519.0', // Simula formato numérico decimal de Excel
      'Fe.contabilización': '12/06/2026',
      'Nombre del usuario': 'PRAC-CON-01',
      'Código transacción': 'FB60',
      'Texto cab.documento': 'SOLO EN SAP',
    },
    {
      Sociedad: '1013',
      'Nº documento': '1900014520', // Sin ceros a la izquierda; SAP TXT tenía 001900014520
      'Fe.contabilización': '12/06/2026',
      'Nombre del usuario': 'NSOTO',
      'Código transacción': 'FB60',
    },
    {
      Sociedad: '1013',
      'Nº documento': '9999999999', // No existe en este período
      'Nombre del usuario': 'BTACUNAN',
    },
  ];

  const resExcelUsr = parsearUsuariosSapCompras(filasExcelSap);
  assert.strictEqual(resExcelUsr.estado, 'ok', 'Excel SAP BKPF válido debe parsear sin error');
  assert.strictEqual(resExcelUsr.registrosValidos, 4);

  // Rechazo si falta columna obligatoria
  const resExcelInvalido = parsearUsuariosSapCompras([{ Sociedad: '1013', Referencia: 'ABC' }]);
  assert.strictEqual(resExcelInvalido.estado, 'error', 'Debe rechazar Excel sin Nº documento / Nombre del usuario');

  // Enriquecimiento post-conciliación sobre docs existentes (flujo en ConciliacionCompras)
  const cruce = enriquecerComprasConUsuariosSap(docs, resExcelUsr.registros);
  assert.strictEqual(cruce.totalCoincidencias, 3, 'Debe cruzar los 3 docs (incluyendo fallback sin ceros a la izquierda)');
  assert.strictEqual(cruce.sinCoincidenciaExcel, 1, 'Debe reportar 1 doc del Excel sin coincidencia en el período');

  const d5Enr = cruce.docs.find((d) => d.nro_doc_sap === '1900014518');
  const d6Enr = cruce.docs.find((d) => d.nro_doc_sap === '1900014519');
  const d7Enr = cruce.docs.find((d) => d.nro_doc_sap === '001900014520');
  assert.strictEqual(d5Enr.usuario_sap, 'ASIS-CON-04');
  assert.strictEqual(d5Enr.sap.transaccion_sap, 'MIRO');
  assert.strictEqual(d6Enr.usuario_sap, 'PRAC-CON-01');
  assert.strictEqual(d7Enr.usuario_sap, 'NSOTO');

  // Persistencia ida y vuelta de N° Documento SAP + Usuario SAP en detalle_compras
  const filaEnr = aFilaBDCompras(d5Enr, { periodoId: 'p-1', empresaId: 'e-1' });
  const recEnr = desdeFilaBDCompras({ ...filaEnr, id: 'id-enr' });
  assert.strictEqual(recEnr.nro_doc_sap, '1900014518');
  assert.strictEqual(recEnr.usuario_sap, 'ASIS-CON-04');
  assert.strictEqual(recEnr.sap.transaccion_sap, 'MIRO');
  assert.strictEqual(recEnr.sap.texto_cabecera, 'PROVEEDOR DIFERENCIAS');

  // Nuevos filtros: docSap y usuarioSap
  assert.strictEqual(filtrarDocumentosCompras(cruce.docs, { ...FILTROS_INICIALES_COMPRAS, docSap: '14518' }).length, 1);
  assert.strictEqual(filtrarDocumentosCompras(cruce.docs, { ...FILTROS_INICIALES_COMPRAS, usuarioSap: 'ASIS-CON-04' }).length, 1);
  assert.strictEqual(filtrarDocumentosCompras(cruce.docs, { ...FILTROS_INICIALES_COMPRAS, usuarioSap: 'SIN_USUARIO' }).length, 6);

  // Exportación Excel con N° Documento SAP, Usuario SAP y resumen por usuario
  const hojasEnr = construirDatosExcelCompras(cruce.docs);
  const filaD5Excel = hojasEnr['Con Diferencias'].find((r) => r['N° Documento SAP'] === '1900014518');
  assert.ok(filaD5Excel, 'La hoja Con Diferencias debe incluir la columna N° Documento SAP');
  assert.strictEqual(filaD5Excel['Usuario SAP'], 'ASIS-CON-04');
  assert.ok(
    hojasEnr['Resumen General'].some((r) => r.Indicador === 'Usuario SAP: ASIS-CON-04' && r.Cantidad === 1),
    'Resumen General debe incluir desglose de documentos con error por Usuario SAP'
  );

  // Worker fallback: PARSE_USUARIOS_SAP_COMPRAS + CONCILIAR_COMPRAS_V2 con usuariosSap
  const wUsr = await runCpuTaskInWorker('PARSE_USUARIOS_SAP_COMPRAS', { filas: filasExcelSap });
  const wConcConUsr = await runCpuTaskInWorker('CONCILIAR_COMPRAS_V2', {
    sap: wSap.registros,
    sunat: wSunat.registros,
    usuariosSap: wUsr.registros,
  });
  assert.strictEqual(
    wConcConUsr.docs.find((d) => d.nro_doc_sap === '1900014518')?.usuario_sap,
    'ASIS-CON-04',
    'Worker CONCILIAR_COMPRAS_V2 debe aplicar el cruce opcional de Usuarios SAP'
  );
}

console.log('✓ Todas las pruebas del módulo de Compras (8 errores, 3 observaciones, tipo 14, clave única, duplicados, N° Doc SAP, Usuarios SAP Excel, copiado total, persistencia, Excel y Worker) pasaron con éxito.');
