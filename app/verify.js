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
import { calcularIndicadores, calcularSecuencias, filtrarDocumentos, FILTROS_INICIALES } from './src/utils/ventas/reportes.js';
import { enriquecerSecuenciasEnDocs } from './src/utils/ventas/reglas.js';
import { normalizarLocales, construirIndiceLocales, coincideConLocal } from './src/utils/locales.js';

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
  assert.strictEqual(series[0].sistema_salto, 'AMBOS');
  const obs3 = docs[2].incidencias.find((i) => i.codigo === 'OBS 3');
  assert.strictEqual(obs3.datos.sistema, 'AMBOS');
  assert.strictEqual(obs3.datos.correlativos_faltantes[0], '1247');
  assert.strictEqual(obs3.datos.rango_faltante, '1247 al 1299');
}

// 4.4b Detección de correlativos faltantes exactos por sistema: Solo SUNAT, Solo SAP, AMBOS y solapamiento parcial
{
  const mk = (tipo, serie, corr, fecha = '2026-11-21') => ({
    linea: 1, clave: `${tipo}|${serie}|${corr}`, tipo_doc_pago: tipo, serie, correlativo: corr,
    fecha_emision: fecha, tipo_identidad: '6', nro_identidad: '20552886441', nombre: 'TEST SAC',
    base: 10000, igv: 1800, exonerado: 0, inafecto: 0, otros: 0, total: 11800, estado: '1',
  });

  // Caso real F635: SAP termina en 3440, SUNAT salta de 3445 a 3447 -> falta 3446 Solo SUNAT
  const sapSunatOnly = [mk('01', 'F635', '3440', '2026-11-20')];
  const sunatF635 = ['3440', '3441', '3442', '3443', '3444', '3445', '3447'].map((c) => mk('01', 'F635', c));
  const resF635 = conciliarVentas({ sap: sapSunatOnly, sunat: sunatF635 });
  const secF635 = calcularSecuencias(resF635.docs);
  assert.strictEqual(secF635.saltos.length, 1);
  assert.strictEqual(secF635.saltos[0].sistema, 'SUNAT', 'El salto 3445 -> 3447 ocurre solo en SUNAT');
  assert.deepStrictEqual(secF635.saltos[0].correlativos_faltantes, ['3446'], 'Debe reportar el correlativo exacto 3446');
  const doc3447 = resF635.docs.find((d) => d.correlativo === '3447');
  assert.ok(doc3447.codigos.includes('OBS 3'));
  assert.ok(doc3447.incidencias.find((i) => i.codigo === 'OBS 3').detalle.includes('3446'));

  // Caso Solo SAP: SAP tiene 100, 102 (falta 101); SUNAT tiene 100, 101, 102
  const resSapOnly = conciliarVentas({
    sap: [mk('01', 'F100', '100'), mk('01', 'F100', '102')],
    sunat: [mk('01', 'F100', '100'), mk('01', 'F100', '101'), mk('01', 'F100', '102')],
  });
  const secSapOnly = calcularSecuencias(resSapOnly.docs);
  assert.strictEqual(secSapOnly.saltos.length, 1);
  assert.strictEqual(secSapOnly.saltos[0].sistema, 'SAP', 'El salto 100 -> 102 ocurre solo en SAP');
  assert.deepStrictEqual(secSapOnly.saltos[0].correlativos_faltantes, ['101']);

  // Caso Solapamiento parcial: SAP tiene 100, 103 (faltan 101 y 102); SUNAT tiene 100, 101, 103 (falta 102)
  const resMixto = conciliarVentas({
    sap: [mk('01', 'F200', '100'), mk('01', 'F200', '103')],
    sunat: [mk('01', 'F200', '100'), mk('01', 'F200', '101'), mk('01', 'F200', '103')],
  });
  const secMixto = calcularSecuencias(resMixto.docs);
  assert.strictEqual(secMixto.saltos.length, 2);
  assert.strictEqual(secMixto.saltos[0].sistema, 'SAP');
  assert.deepStrictEqual(secMixto.saltos[0].correlativos_faltantes, ['101']);
  assert.strictEqual(secMixto.saltos[1].sistema, 'AMBOS');
  assert.deepStrictEqual(secMixto.saltos[1].correlativos_faltantes, ['102']);

  // Enriquecimiento en memoria de registros históricos (cargados desde BD con OBS 3 antiguo)
  const docLegacy = resF635.docs.map((d) => ({
    ...d,
    incidencias: d.incidencias.map((inc) =>
      inc.codigo === 'OBS 3' ? { ...inc, detalle: 'Legacy OBS 3', datos: { serie: 'F635', anterior: '3445', siguiente: '3447', faltantes: 1 } } : inc
    ),
  }));
  const enriquecidos = enriquecerSecuenciasEnDocs(docLegacy);
  const obs3Enr = enriquecidos.find((d) => d.correlativo === '3447').incidencias.find((i) => i.codigo === 'OBS 3');
  assert.strictEqual(obs3Enr.datos.sistema, 'SUNAT');
  assert.deepStrictEqual(obs3Enr.datos.correlativos_faltantes, ['3446']);
}

// 4.5 Locales y series por empresa (CHIFAS DEL PERU SAC)
{
  const rawLocales = [
    {
      id: 'loc-mega',
      empresa_id: 'emp-chifas',
      nombre: 'Mr Shao Megaplaza',
      activo: true,
      local_series: [
        { id: '1', tipo_doc_pago: '01', serie: 'F635' },
        { id: '2', tipo_doc_pago: '01', serie: 'F611' },
        { id: '3', tipo_doc_pago: '03', serie: 'B635' },
        { id: '4', tipo_doc_pago: '03', serie: 'B611' },
      ],
    },
    {
      id: 'loc-bo',
      empresa_id: 'emp-chifas',
      nombre: 'Mr Shao Backoffice',
      activo: true,
      local_series: [
        { id: '5', tipo_doc_pago: '01', serie: 'FE01' },
        { id: '6', tipo_doc_pago: '03', serie: 'BE01' },
        { id: '7', tipo_doc_pago: '07', serie: 'BC01' },
      ],
    },
  ];
  const localesNorm = normalizarLocales(rawLocales);
  const idx = construirIndiceLocales(localesNorm);
  assert.strictEqual(idx.obtenerLocal('F635', '01')?.nombre, 'Mr Shao Megaplaza');
  assert.strictEqual(idx.obtenerLocal('BC01', '07')?.nombre, 'Mr Shao Backoffice');
  assert.strictEqual(idx.obtenerLocal('F999', '01'), null);

  const docsMuestra = [
    { tipo_doc_pago: '01', serie: 'F635', correlativo: '1', estado: 'OK', en_sap: true, en_sunat: true, codigos: [] },
    { tipo_doc_pago: '03', serie: 'B611', correlativo: '2', estado: 'OK', en_sap: true, en_sunat: true, codigos: [] },
    { tipo_doc_pago: '07', serie: 'BC01', correlativo: '3', estado: 'OK', en_sap: true, en_sunat: true, codigos: [] },
    { tipo_doc_pago: '01', serie: 'F999', correlativo: '4', estado: 'OK', en_sap: true, en_sunat: true, codigos: [] },
  ];
  assert.strictEqual(filtrarDocumentos(docsMuestra, { ...FILTROS_INICIALES, localId: 'loc-mega' }, idx).length, 2);
  assert.strictEqual(filtrarDocumentos(docsMuestra, { ...FILTROS_INICIALES, localId: 'loc-bo' }, idx).length, 1);
  assert.strictEqual(filtrarDocumentos(docsMuestra, { ...FILTROS_INICIALES, localId: 'SIN_LOCAL' }, idx).length, 1);
  assert.strictEqual(coincideConLocal(docsMuestra[0], 'ALL', idx), true);
}

// 4.6 Factura con RUC extranjero (inicia con 15), totales coincidentes vs OBS 4 y multi-error
{
  const mk = (overrides) => ({
    linea: 1, tipo_doc_pago: '01', serie: 'F608', correlativo: '2572',
    clave: '01|F608|2572', fecha_emision: '2026-11-01', tipo_identidad: '6',
    nro_identidad: '15613145122', nombre: 'EXTRANJERO TEST',
    base: 10000, igv: 1800, exonerado: 0, inafecto: 0, otros: 0, total: 11800, estado: '1',
    ...overrides,
  });

  // Factura con RUC 15 debe ser válida (sin OBS 6)
  const f15 = mk({});
  const soloSunat = mk({ correlativo: '2573', clave: '01|F608|2573', nro_identidad: '20553596441', base: 50000, igv: 9000, total: 59000 });
  const multiErrSap = mk({ correlativo: '2574', clave: '01|F608|2574', nro_identidad: '20553596441', base: 10000, igv: 1800, otros: 60, total: 11860 });
  const multiErrSunat = mk({ correlativo: '2574', clave: '01|F608|2574', nro_identidad: '20553596441', base: 9900, igv: 1800, otros: 0, total: 11700 });

  const { docs } = conciliarVentas({
    sap: [f15, multiErrSap],
    sunat: [f15, soloSunat, multiErrSunat],
  });

  const d15 = docs.find((d) => d.correlativo === '2572');
  assert.strictEqual(d15.estado, 'OK', 'Factura con RUC que inicia en 15 debe ser válida (OK)');
  assert.strictEqual(d15.codigos.includes('OBS 6'), false);

  const ind = calcularIndicadores(docs);
  // Coincidentes solo incluye 2572 y 2574 (excluye soloSunat de S/ 500.00 BI)
  assert.strictEqual(ind.sumasCoincidentes.base_sap - ind.sumasCoincidentes.base_sunat, 100, 'Diferencia BI coincidentes = S/ 1.00 (no incluye los S/ 500 de OBS 4)');
  assert.strictEqual(ind.sumasSoloSunat.base, 50000, 'Monto BI de OBS 4 separado correctamente');
  assert.strictEqual(ind.conErrores, 1, '1 documento único con error');
  assert.strictEqual(ind.docsConMultiplesErrores, 1, 'El doc 2574 tiene múltiples errores (ERROR 1, ERROR 5 y ERROR 7)');
  assert.strictEqual(ind.totalHallazgosError, 3, 'Total hallazgos de error = 3 (1+1+1)');

  // Re-evaluación automática de RUC 15 en períodos históricos cargados desde BD
  const legacyConObs6 = docs.map((d) =>
    d.correlativo === '2572'
      ? {
          ...d,
          estado: 'OBSERVADO',
          codigos: ['OBS 6'],
          incidencias: [{ codigo: 'OBS 6', tipo: 'OBS', descripcion: 'OBS 6', detalle: 'Legacy 20/10', regla: 'R-ID-05', datos: {} }],
        }
      : d
  );
  const reeval = enriquecerSecuenciasEnDocs(legacyConObs6);
  const d15Reeval = reeval.find((d) => d.correlativo === '2572');
  assert.strictEqual(d15Reeval.estado, 'OK', 'enriquecerSecuenciasEnDocs debe revalidar RUC 15 en períodos históricos');
  assert.strictEqual(d15Reeval.codigos.includes('OBS 6'), false);
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
// 2. PRUEBA FUNCIONAL CON ARCHIVOS DE REFERENCIA REALES (OPCIONAL POR ENV)
// ============================================================================
const samplesDir = process.env.VERIFY_SAMPLES_DIR || '';
const sapPath = samplesDir ? path.join(samplesDir, 'LE2053799558120260600140100001111.txt') : '';
const sunatPath = samplesDir ? path.join(samplesDir, 'LE205379955812026060014040001EXP2.txt') : '';
const cortesiasPath = samplesDir ? path.join(samplesDir, 'cortesias.xlsx') : '';

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


// ============================================================================
// 3. VERIFICACIÓN DE RENDIMIENTO, TELEMETRÍA, POOL, WORKERS Y REDES LENTAS
// ============================================================================
import {
  startSpan,
  getTelemetrySummary,
  clearTelemetry,
  createInstrumentedFetch,
} from './src/utils/telemetry.js';
import { getNetworkProfile, simulateNetworkProfile } from './src/utils/networkProfile.js';
import { executeParallelBatches, runCpuTaskInWorker } from './src/utils/jobQueue.js';
import { calculateVirtualRange } from './src/utils/useVirtualList.js';
import { fetchAllSupabasePages } from './src/utils/supabasePagination.js';

console.log('\n=== 3. PRUEBAS DE OPTIMIZACIÓN DE RENDIMIENTO Y REDES LENTAS ===');

// 3.1 OpenTelemetry Tracing + Detección de peticiones lentas
{
  clearTelemetry();
  const fastSpan = startSpan('DB:fast_query');
  fastSpan.end({ thresholdMs: 500 });

  const slowSpan = startSpan('DB:slow_query');
  slowSpan.end({ thresholdMs: 0 }); // forzar detección como petición lenta

  const summary = getTelemetrySummary();
  assert.strictEqual(summary.totalSpans, 2, 'Debe registrar 2 spans de OpenTelemetry');
  assert.strictEqual(summary.slowCount, 1, 'Debe detectar 1 petición lenta');
  assert.ok(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/.test(fastSpan.traceparent), 'Formato W3C traceparent válido');
}

// 3.2 Deduplicación de llamadas concurrentes idénticas + Pool de Conexiones + Balanceo Multi-Instancia
{
  clearTelemetry();
  let underlyingNetworkCalls = 0;
  const seenTraceparents = [];
  const hitHosts = [];

  const mockFetch = async (url, init) => {
    underlyingNetworkCalls += 1;
    hitHosts.push(new URL(url).origin);
    seenTraceparents.push(init?.headers?.get('traceparent'));
    await new Promise((r) => setTimeout(r, 25));
    return new Response(JSON.stringify({ ok: true, url }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const instrumented = createInstrumentedFetch({
    baseFetch: mockFetch,
    maxConcurrent: 2,
    primaryUrl: 'https://primary.supabase.co',
    readUrls: ['https://replica-1.supabase.co', 'https://replica-2.supabase.co'],
  });

  // Lanzar 3 llamadas GET idénticas en paralelo -> deben deduplicarse en 1 sola llamada real
  const [r1, r2, r3] = await Promise.all([
    instrumented('https://primary.supabase.co/rest/v1/empresas?select=id,ruc', { method: 'GET' }),
    instrumented('https://primary.supabase.co/rest/v1/empresas?select=id,ruc', { method: 'GET' }),
    instrumented('https://primary.supabase.co/rest/v1/empresas?select=id,ruc', { method: 'GET' }),
  ]);

  assert.strictEqual(underlyingNetworkCalls, 1, 'Las 3 peticiones GET idénticas concurrentes deben deduplicarse en 1 llamada HTTP');
  assert.strictEqual((await r1.json()).ok, true);
  assert.strictEqual((await r2.json()).ok, true);
  assert.strictEqual((await r3.json()).ok, true);

  // Segunda consulta distinta debe balancearse a la siguiente réplica (Round-Robin)
  await instrumented('https://primary.supabase.co/rest/v1/periodos_carga?select=id', { method: 'GET' });
  assert.deepStrictEqual(
    hitHosts,
    ['https://replica-1.supabase.co', 'https://replica-2.supabase.co'],
    'El tráfico de lectura debe repartirse en Round-Robin entre las instancias'
  );
  assert.ok(seenTraceparents.every((tp) => /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/.test(tp)), 'Todas las llamadas incluyen traceparent');
}

// 3.3 Cola de Trabajo Paralela (JobQueue) y Worker Fallback
{
  const items = Array.from({ length: 25 }, (_, i) => i + 1);
  const batchesProcessed = [];
  await executeParallelBatches(
    items,
    10,
    async (chunk, idx) => {
      batchesProcessed.push({ idx, len: chunk.length });
    },
    { concurrency: 3, label: 'TestParallelBatch' }
  );
  assert.strictEqual(batchesProcessed.length, 3, '25 elementos en bloques de 10 deben generar 3 lotes paralelos');

  const workerRes = await runCpuTaskInWorker('CONCILIAR_VENTAS', {
    sap: [
      { linea: 1, clave: '03|B805|99', tipo_doc_pago: '03', serie: 'B805', correlativo: '99', fecha_emision: '2026-06-01', tipo_identidad: '1', nro_identidad: '45401715', nombre: 'TEST WORKER', base: 10000, igv: 1800, exonerado: 0, inafecto: 0, otros: 0, total: 11800, estado: '1' },
    ],
    sunat: [
      { linea: 1, clave: '03|B805|99', tipo_doc_pago: '03', serie: 'B805', correlativo: '99', fecha_emision: '2026-06-01', tipo_identidad: '1', nro_identidad: '45401715', nombre: 'TEST WORKER', base: 10000, igv: 1800, exonerado: 0, inafecto: 0, otros: 0, total: 11800, estado: '1' },
    ],
  });
  assert.strictEqual(workerRes.docs.length, 1);
  assert.strictEqual(workerRes.docs[0].estado, 'OK');
}

// 3.4 Virtualización de Listas Largas
{
  const v = calculateVirtualRange({
    totalCount: 500,
    scrollTop: 1800,
    viewportHeight: 560,
    rowHeight: 36,
    overscan: 8,
    enabled: true,
  });
  assert.strictEqual(v.isVirtualized, true);
  assert.ok(v.endIndex - v.startIndex < 40, 'En una lista de 500 filas solo debe renderizar ~32 nodos DOM en el viewport');
  assert.strictEqual(v.topPaddingHeight + (v.endIndex - v.startIndex) * 36 + v.bottomPaddingHeight, 500 * 36);
}

// 3.5 Simulación y Prueba en Móviles y Redes Lentas (3G / Save-Data)
{
  simulateNetworkProfile({
    isMobile: true,
    isSlowNetwork: true,
    saveData: true,
    effectiveType: '3g',
    rtt: 480,
    downlink: 0.9,
  });
  const slowProfile = getNetworkProfile();
  assert.strictEqual(slowProfile.isMobile, true);
  assert.strictEqual(slowProfile.isSlowNetwork, true);
  assert.strictEqual(slowProfile.recommendedPageSize, 15, 'En móvil/red lenta debe reducir la paginación a 15 filas');
  assert.strictEqual(slowProfile.recommendedBatchSize, 250, 'En red lenta debe reducir los lotes a 250 registros');
  assert.strictEqual(slowProfile.recommendedConcurrency, 1, 'En red lenta debe limitar la concurrencia a 1');
  simulateNetworkProfile(null);
}

// 3.6 Paginación Supabase > 12,000 filas respetando límite max_rows del servidor (1000 / 500)
{
  const TOTAL_ROWS = 12587;
  const dataset = Array.from({ length: TOTAL_ROWS }, (_, idx) => ({ id: idx + 1 }));

  const createMockPostgrest = (serverMaxRows, returnCount = true) => {
    let calls = 0;
    return {
      getCalls: () => calls,
      fetchPage: async (from, to, withCount) => {
        calls += 1;
        const limit = Math.min(to - from + 1, serverMaxRows);
        const slice = dataset.slice(from, from + limit);
        return {
          data: slice,
          count: returnCount && withCount ? TOTAL_ROWS : null,
          error: null,
        };
      },
    };
  };

  // Caso 1: Cliente solicita pageSize=1500 (como recommendedBatchSize en 4G), servidor PostgREST capa en 1000
  const mock1000 = createMockPostgrest(1000, true);
  const all1000 = await fetchAllSupabasePages({
    fetchPage: mock1000.fetchPage,
    pageSize: 1500,
    concurrency: 4,
    label: 'TestMaxRows1000',
  });
  assert.strictEqual(all1000.length, TOTAL_ROWS, 'Debe descargar las 12,587 filas completas sin truncar en 1,000');
  assert.strictEqual(all1000[0].id, 1);
  assert.strictEqual(all1000[TOTAL_ROWS - 1].id, TOTAL_ROWS);
  assert.strictEqual(mock1000.getCalls(), 13, '12,587 filas en bloques de 1,000 requieren 13 peticiones');

  // Caso 2: Servidor PostgREST con max_rows aún menor (500) -> adapta paso automáticamente sin perder filas
  const mock500 = createMockPostgrest(500, true);
  const all500 = await fetchAllSupabasePages({
    fetchPage: mock500.fetchPage,
    pageSize: 1000,
    concurrency: 4,
    label: 'TestMaxRows500',
  });
  assert.strictEqual(all500.length, TOTAL_ROWS, 'Debe adaptar el paso al límite real del servidor (500) sin perder filas');
  assert.strictEqual(all500[1000].id, 1001);
  assert.strictEqual(all500[TOTAL_ROWS - 1].id, TOTAL_ROWS);

  // Caso 3: Sin `count` en la respuesta -> fallback secuencial hasta agotar filas
  const mockNoCount = createMockPostgrest(1000, false);
  const allNoCount = await fetchAllSupabasePages({
    fetchPage: mockNoCount.fetchPage,
    pageSize: 1000,
    concurrency: 4,
    label: 'TestNoCount',
  });
  assert.strictEqual(allNoCount.length, TOTAL_ROWS, 'Sin count exacto debe seguir paginando hasta completar todas las filas');
}

// 3.7 Verificación de Imágenes WebP / AVIF y Vista SQL sin N+1
{
  assert.ok(fs.existsSync(path.resolve('./public/logo-pardos.webp')), 'Debe existir logo-pardos.webp');
  assert.ok(fs.existsSync(path.resolve('./public/logo-pardos.avif')), 'Debe existir logo-pardos.avif');
  const viewsSql = fs.readFileSync(path.resolve('../supabase/views.sql'), 'utf-8');
  assert.ok(viewsSql.includes('LEFT JOIN public.v_resumen_ventas'), 'v_historial_cargas debe usar LEFT JOIN pre-agregado sin subconsultas N+1');
}

console.log('✓ Todas las pruebas de rendimiento, telemetría, pool, workers, virtualización y redes lentas pasaron con éxito.');
