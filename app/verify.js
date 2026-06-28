import fs from 'fs';
import path from 'path';
import { parseSAP, parseSUNAT, parseSIRE, stripBOM } from './src/utils/parsers.js';
import { reconcileData } from './src/utils/validations.js';

// Encodings mapping as defined in the plan:
// SUNAT: UTF-8 (remover BOM)
// SAP: Windows-1252 (Latin1)
// SIRE: Windows-1252 (Latin1)

const sunatPath = '../LE205379955812026060014040001EXP2.txt';
const sapPath = '../LE2053799558120260600140100001111.txt';
const sirePath = '../LOG SIRE Ventas_1007_062026.TXT';

try {
  console.log('--- Iniciando Verificación de Reglas Tributarias ---');

  // 1. Leer archivos
  const sunatRaw = fs.readFileSync(sunatPath, { encoding: 'utf8' });
  const sunatText = stripBOM(sunatRaw);

  const sapText = fs.readFileSync(sapPath, { encoding: 'latin1' });
  const sireText = fs.readFileSync(sirePath, { encoding: 'latin1' });

  // 2. Parsear
  const sunatList = parseSUNAT(sunatText);
  const sapList = parseSAP(sapText);
  const sireList = parseSIRE(sireText);

  console.log(`Registros SUNAT parseados: ${sunatList.length}`);
  console.log(`Registros SAP parseados: ${sapList.length}`);
  console.log(`Registros SIRE parseados: ${sireList.length}`);

  // 3. Conciliar
  const companyRuc = '20537995581';
  const reconciled = reconcileData(sapList, sunatList, sireList, companyRuc);

  console.log(`\nTotal unificados final: ${reconciled.length}`);

  // 4. Estadísticas
  let countOk = 0;
  let countError = 0;
  let countObs = 0;
  let countCortesia = 0;

  reconciled.forEach(r => {
    if (r.estado_validacion === 'OK') countOk++;
    if (r.estado_validacion === 'ERROR') countError++;
    if (r.estado_validacion === 'OBSERVADO') countObs++;
    if (r.tipo_pago_sire === 'CORTESIA') countCortesia++;
  });

  console.log(`\n--- Estadísticas de Conciliación ---`);
  console.log(`✓ OK: ${countOk}`);
  console.log(`⚠ OBSERVADO: ${countObs}`);
  console.log(`✗ ERROR: ${countError}`);
  console.log(`🎁 CORTESÍAS DETECTADAS: ${countCortesia}`);

  // 5. Verificar cortesías
  const cortesiaConDiferencias = reconciled.filter(r => 
    r.tipo_pago_sire === 'CORTESIA' && r.estado_validacion !== 'OK'
  );
  console.log(`Cortesías no marcadas como OK: ${cortesiaConDiferencias.length}`);
  if (cortesiaConDiferencias.length > 0) {
    console.log('Ejemplos de cortesías con observaciones/errores:');
    cortesiaConDiferencias.slice(0, 10).forEach(r => {
      console.log(`- Folio: ${r.serie}-${r.correlativo} | ValState: ${r.estado_validacion} | Errores: ${r.errores_json.join(', ')}`);
    });
  }

  // 6. Verificar algunos errores
  console.log(`\nEjemplos de errores encontrados (primeros 5):`);
  const errorSamples = reconciled.filter(r => r.estado_validacion === 'ERROR').slice(0, 5);
  errorSamples.forEach(r => {
    console.log(`- Folio: ${r.serie}-${r.correlativo} | Cliente: ${r.nombre_sunat || 'N/A'} | Errores: ${r.errores_json.join(', ')}`);
  });

  console.log(`\nEjemplos de observaciones encontradas (primeras 5):`);
  const obsSamples = reconciled.filter(r => r.estado_validacion === 'OBSERVADO').slice(0, 5);
  obsSamples.forEach(r => {
    console.log(`- Folio: ${r.serie}-${r.correlativo} | Observaciones: ${r.errores_json.join(', ')}`);
  });

} catch (err) {
  console.error('Error durante la verificación:', err);
}
