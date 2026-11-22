// ============================================================================
// Script de verificación funcional del motor de Ventas con los archivos reales
// de referencia (SAP 1111, SUNAT EXP2 y Excel de Cortesías) + pruebas unitarias
// de cada regla de la hoja "flujo".
// ============================================================================
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import * as XLSX from 'xlsx';
import { decodificarTexto, parsearSapVentas, parsearSunatVentas, parsearCortesias } from './src/utils/ventas/lectores.js';
import { normalizarNumeroDocumento } from './src/utils/ventas/documento.js';
import { conciliarVentas } from './src/utils/ventas/motor.js';
import { aFilaBD, desdeFilaBD } from './src/utils/ventas/persistencia.js';
import { calcularIndicadores, filtrarDocumentos, FILTROS_INICIALES } from './src/utils/ventas/reportes.js';

console.log('=== 1. PRUEBAS UNITARIAS DE REGLAS DE LA HOJA FLUJO ===');

// 4.1 Normalización del número de documento (15 caracteres)
{
  const b = normalizarNumeroDocumento('B00805000010131');
  assert.strictEqual(b.valido, true);
  assert.strictEqual(b.letra, 'B');
  assert.strictEqual(b.tipo_doc_pago, '03');
  assert.strictEqual(b.serieNumero, '805');
  assert.strictEqual(b.serie, 'B805');
  assert.strictEqual(b.correlativo, '000010131'); // conserva ceros a la izquierda

  const f = normalizarNumeroDocumento('F00807000001695');
  assert.strictEqual(f.valido, true);
  assert.strictEqual(f.tipo_doc_pago, '01');
  assert.strictEqual(f.serie, 'F807');
  assert.strictEqual(f.correlativo, '000001695');

  const inv = normalizarNumeroDocumento('X123');
  assert.strictEqual(inv.valido, false);
}

// 4.4 Secuencia con diferencia de días NO es error; salto de correlativo SÍ es OBS 3
{
  const sap = [
    { linea: 1, clave: '03|B633|1245', tipo_doc_pago: '03', serie: 'B633', correlativo: '1245', fecha_emision: '2026-11-13', tipo_identidad: '1', nro_identidad: '45401715', nombre: 'JUAN PEREZ', base: 10000, igv: 1800, exonerado: 0, inafecto: 0, otros: 0, total: 11800, estado: '1' },
    { linea: 2, clave: '03|B633|1246', tipo_doc_pago: '03', serie: 'B633', correlativo: '1246', fecha_emision: '2026-11-16', tipo_identidad: '1', nro_identidad: '45401715', nombre: 'JUAN PEREZ', base: 10000, igv: 1800, exonerado: 0, inafecto: 0, otros: 0, total: 11800, estado: '1' },
    { linea: 3, clave: '03|B633|1300', tipo_doc_pago: '03', serie: 'B633', correlativo: '1300', fecha_emision: '2026-11-16', tipo_identidad: '1', nro_identidad: '45401715', nombre: 'JUAN PEREZ', base: 10000, igv: 1800, exonerado: 0, inafecto: 0, otros: 0, total: 11800, estado: '1' },
  ];
  const { docs, series } = conciliarVentas({ sap, sunat: sap });
  assert.strictEqual(docs[1].codigos.includes('OBS 3'), false, 'B633-1245 -> B633-1246 con 3 días de diferencia debe ser secuencia correcta');
  assert.strictEqual(docs[2].codigos.includes('OBS 3'), true, 'B633-1246 -> B633-1300 debe marcar OBS 3');
  assert.strictEqual(series[0].saltos, 1);
  assert.strictEqual(series[0].faltantes, 53);
}

// 6. Tolerancia de S/ 0.05 exacta y 8. Prioridad ERROR > OBSERVADO > OK sin sobrescribir incidencias
{
  const sap = [
    { linea: 1, clave: '03|B805|1', tipo_doc_pago: '03', serie: 'B805', correlativo: '0000001', fecha_emision: '2026-06-01', tipo_identidad: '0', nro_identidad: '00000000', nombre: 'CLIENTE GENERICO', base: 60000, igv: 10800, exonerado: 0, inafecto: 0, otros: 0, total: 70800, estado: '1' },
  ];
  const sunat = [
    { linea: 1, clave: '03|B805|1', tipo_doc_pago: '03', serie: 'B805', correlativo: '1', fecha_emision: '2026-06-01', tipo_identidad: '1', nro_identidad: '45401715', nombre: 'ANA ZAPATA', base: 60005, igv: 10800, exonerado: 0, inafecto: 0, otros: 0, total: 70810, estado: '1' },
  ];
  const { docs } = conciliarVentas({ sap, sunat });
  const d = docs[0];
  // diff BI = 0.05 (dentro de tolerancia -> no ERROR 1), diff Total = 0.10 (> 0.05 -> ERROR 5)
  // Boleta > 700 con tipo 0 en SAP -> ERROR 6
  // Tipo ID SAP (0) != SUNAT (1) -> OBS 1; Nro ID SAP != SUNAT -> OBS 2
  assert.strictEqual(d.codigos.includes('ERROR 1'), false, 'Diferencia de S/ 0.05 exacta debe ser correcta');
  assert.strictEqual(d.codigos.includes('ERROR 5'), true, 'Diferencia de S/ 0.10 en total debe ser ERROR 5');
  assert.strictEqual(d.codigos.includes('ERROR 6'), true, 'Boleta > 700 sin DNI en SAP debe ser ERROR 6');
  assert.strictEqual(d.codigos.includes('OBS 1'), true, 'Debe conservar OBS 1 junto con los errores');
  assert.strictEqual(d.codigos.includes('OBS 2'), true, 'Debe conservar OBS 2 junto con los errores');
  assert.strictEqual(d.estado, 'ERROR', 'Estado general debe priorizar ERROR sobre OBSERVADO');

  // Ida y vuelta de persistencia JSONB
  const fila = aFilaBD(d, { periodoId: 'p1', empresaId: 'e1', ruc: '20537995581' });
  const reconstruido = desdeFilaBD(fila);
  assert.deepStrictEqual(reconstruido.codigos, d.codigos);
  assert.strictEqual(reconstruido.sap.correlativo, '0000001', 'Debe conservar ceros a la izquierda originales de SAP');
}

console.log('✓ Pruebas unitarias de reglas superadas correctamente.\n');

// ============================================================================
// 2. PRUEBA FUNCIONAL CON ARCHIVOS DE REFERENCIA REALES
// ============================================================================
const scratchDir = '/home/diego/.gemini/antigravity/brain/b23485a4-fad9-4b68-819b-7f7107079ae2/scratch';
const sapPath = path.join(scratchDir, 'LE2053799558120260600140100001111.txt');
const sunatPath = path.join(scratchDir, 'LE205379955812026060014040001EXP2.txt');
const cortesiasPath = path.resolve('../data - 2026-06-25T224652.394.xlsx');

if (fs.existsSync(sapPath) && fs.existsSync(sunatPath)) {
  console.log('=== 2. EJECUCIÓN CON ARCHIVOS REALES DE REFERENCIA (PERÍODO 202606) ===');
  const sapBuf = fs.readFileSync(sapPath);
  const sunatBuf = fs.readFileSync(sunatPath);

  const sapDec = decodificarTexto(sapBuf);
  const sunatDec = decodificarTexto(sunatBuf);

  const resSap = parsearSapVentas(sapDec.texto);
  const resSunat = parsearSunatVentas(sunatDec.texto);

  let resCortesias = null;
  if (fs.existsSync(cortesiasPath)) {
    const wb = XLSX.read(fs.readFileSync(cortesiasPath), { type: 'buffer' });
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: false, defval: '' });
    resCortesias = parsearCortesias(filas);
  }

  console.log(`SAP   : estado=${resSap.estado} | leídos=${resSap.registrosLeidos} | únicos=${resSap.registrosValidos} | dup=${resSap.duplicados.length}`);
  console.log(`SUNAT : estado=${resSunat.estado} | leídos=${resSunat.registrosLeidos} | únicos=${resSunat.registrosValidos} | dup=${resSunat.duplicados.length}`);
  if (resCortesias) {
    console.log(`CORT. : estado=${resCortesias.estado} | leídos=${resCortesias.registrosLeidos} | válidos=${resCortesias.registrosValidos} | vacíos=${resCortesias.lineasVacias}`);
  }

  const { docs, series, cortesiasNoEncontradas } = conciliarVentas({
    sap: resSap.registros,
    sunat: resSunat.registros,
    cortesias: resCortesias?.registros || null,
  });

  const ind = calcularIndicadores(docs);
  console.log('\n--- 10 Indicadores Generales (Sección 3.B) ---');
  console.log(`1. Total documentos en SAP             : ${ind.totalSap}`);
  console.log(`2. Total documentos en SUNAT           : ${ind.totalSunat}`);
  console.log(`3. Total documentos coincidentes       : ${ind.coincidentes}`);
  console.log(`4. Total documentos correctos (OK)     : ${ind.correctos}`);
  console.log(`5. Total documentos con observaciones  : ${ind.conObservaciones}`);
  console.log(`6. Total documentos con errores        : ${ind.conErrores}`);
  console.log(`7. Únicamente en SAP (OBS 5)           : ${ind.soloSap}`);
  console.log(`8. Únicamente en SUNAT (OBS 4)         : ${ind.soloSunat}`);
  console.log(`9. Con diferencias de importes         : ${ind.conDifImportes}`);
  console.log(`10. Con problemas de identificación    : ${ind.conProbIdentidad}`);
  console.log(`   Total documentos únicos (SAP ∪ SUNAT): ${ind.totalUnicos}`);
  console.log(`   Cortesías identificadas             : ${ind.cortesias} (no encontradas en TXT: ${cortesiasNoEncontradas.length})`);

  console.log('\n--- Conteo por Grupo de Error y Observación (Sección 9) ---');
  for (const [cod, cnt] of Object.entries(ind.porCodigo)) {
    console.log(`   ${cod.padEnd(8)}: ${cnt}`);
  }

  console.log('\n--- Continuidad de Secuencia por Serie (Sección 4.4) ---');
  for (const s of series) {
    console.log(`   Serie ${s.serie} (Tipo ${s.tipo_doc_pago}): ${s.documentos} docs [${s.primero}..${s.ultimo}] -> ${s.saltos} salto(s), ${s.faltantes} faltante(s)`);
  }

  // Invariantes matemáticos obligatorios
  assert.strictEqual(ind.totalUnicos, ind.coincidentes + ind.soloSap + ind.soloSunat);
  assert.strictEqual(ind.totalSap, ind.coincidentes + ind.soloSap);
  assert.strictEqual(ind.totalSunat, ind.coincidentes + ind.soloSunat);
  assert.strictEqual(ind.totalUnicos, ind.correctos + ind.conObservaciones + ind.conErrores);

  // Verificar filtro multi-selección
  const filtradosErr = filtrarDocumentos(docs, { ...FILTROS_INICIALES, codigos: ['ERROR 6', 'OBS 4'] });
  assert.strictEqual(filtradosErr.length, ind.porCodigo['ERROR 6'] + ind.porCodigo['OBS 4']);

  console.log('\n✓ Todos los invariantes contables y pruebas funcionales con datos reales se cumplieron.');
}
