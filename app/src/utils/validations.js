import { normalizeDocType } from './parsers.js';

const allCharactersEqual = (str) => {
  if (!str) return false;
  return str.split('').every(char => char === str[0]);
};

export const isRecordAnulado = (row) => {
  if (!row) return false;
  return (
    row.estado_sap === '2' || 
    row.estado_sunat === '2' || 
    row.nombre_sap?.toUpperCase() === 'ANULADO' ||
    (
      (row.base_sap || 0) === 0 &&
      (row.igv_sap || 0) === 0 &&
      (row.total_sap || 0) === 0 &&
      (row.base_sunat || 0) === 0 &&
      (row.igv_sunat || 0) === 0 &&
      (row.total_sunat || 0) === 0 &&
      (row.exonerado_sap || 0) === 0 &&
      (row.exonerado_sunat || 0) === 0 &&
      (row.inafecto_sap || 0) === 0 &&
      (row.inafecto_sunat || 0) === 0 &&
      (row.otros_sap || 0) === 0 &&
      (row.otros_sunat || 0) === 0
    )
  );
};

// Generar CAR SUNAT desde los datos de SAP
export function buildCarFromSAP(rucEmpresa, tipo, serie, correlativo) {
  const tipoPad = normalizeDocType(tipo).padStart(2, '0');
  const corrPad = parseInt(correlativo, 10).toString().padStart(10, '0');
  return `${rucEmpresa}${tipoPad}${serie.trim().toUpperCase()}${corrPad}`;
}

export function buildCortesiasSet(rows) {
  const set = new Set();
  for (const row of rows) {
    const doc = (row['Documento'] || '').trim();
    if (!doc || doc.length < 10) continue;
    const tipoLetra = doc[0].toUpperCase();
    const tipoCP = tipoLetra === 'B' ? '03' : '01';
    const serie = tipoLetra + parseInt(doc.slice(1, 4), 10) + doc.slice(4, 6);
    const corr = parseInt(doc.slice(6), 10).toString();
    set.add(`${tipoCP}-${serie}-${corr}`);
  }
  return set;
}

export function isValidIdentityNumber(tipo, nro) {
  if (!nro) return false;
  const clean = nro.trim();

  // Si contiene solo ceros, su longitud debe ser exactamente 1 o 8 (ej: "0" o "00000000")
  if (/^0+$/.test(clean)) {
    return clean.length === 1 || clean.length === 8;
  }

  if (tipo === '1') { // DNI
    return clean.length === 8 && /^\d+$/.test(clean);
  }
  if (tipo === '6') { // RUC
    return clean.length === 11 && /^\d+$/.test(clean);
  }
  if (tipo === '4') { // CE
    return clean.length === 9;
  }
  if (tipo === '7') { // Pasaporte
    return clean.length >= 3 && clean.length <= 12;
  }
  if (tipo === '0') { // Sin documento / Otros
    return clean.length >= 1 && clean.length <= 15;
  }
  return clean.length > 0 && clean.length <= 15;
}

export function validateRow(row, cortesiasSet = new Set()) {
  const errors = [];
  let status = 'OK';

  const isAnulado = isRecordAnulado(row);

  if (isAnulado) {
    return { status: 'OK', errors: ['Documento Anulado (validaciones omitidas)'] };
  }

  // Validaciones de Existencia (Nuevas Reglas de Null)
  const isNoExisteSAP = row.nro_identidad_sap === null && row.nombre_sap === null;
  const isNoExisteSUNAT = row.nro_identidad_sunat === null && row.nombre_sunat === null;

  if (isNoExisteSAP) {
    errors.push("OBS 4: NO EXISTE EN SAP");
  }
  if (isNoExisteSUNAT) {
    errors.push("OBS 5: NO EXISTE EN SUNAT");
  }

  // Si no existe de un lado, no realizamos comparaciones cruzadas de montos ni identidad
  if (!isNoExisteSAP && !isNoExisteSUNAT) {
    // 1. Diferencia en la BI Gravada
    const diffBase = Math.abs(row.base_sap - row.base_sunat);
    if (diffBase > 0.05) {
      errors.push("ERROR 1: DIFERENCIA EN LA BI Gravada");
    }

    // 2. Diferencia en el IGV / IPM
    const diffIgv = Math.abs(row.igv_sap - row.igv_sunat);
    if (diffIgv > 0.05) {
      errors.push("ERROR 2: DIFERENCIA EN EL IGV / IPM");
    }

    // 3. Diferencia en Mto Exonerado
    const diffExonerado = Math.abs((row.exonerado_sap || 0) - (row.exonerado_sunat || 0));
    if (diffExonerado > 0.05) {
      errors.push("ERROR 3: DIFERENCIA EN Mto Exonerado");
    }

    // 4. Diferencia en Mto Inafecto
    const diffInafecto = Math.abs((row.inafecto_sap || 0) - (row.inafecto_sunat || 0));
    if (diffInafecto > 0.05) {
      errors.push("ERROR 4: DIFERENCIA EN Mto Inafecto");
    }

    // 5. Diferencia en Totales
    const diffTotal = Math.abs(row.total_sap - row.total_sunat);
    if (diffTotal > 0.05) {
      errors.push("ERROR 5: DIFERENCIA EN TOTALES");
    }

    // OBS 1: DIFERENCIA EN TIPO DE IDENTIDAD
    if (row.tipo_identidad_sap !== null && row.tipo_identidad_sunat !== null && row.tipo_identidad_sap !== row.tipo_identidad_sunat) {
      errors.push("OBS 1: DIFERENCIA EN TIPO DE IDENTIDAD");
      errors.push(`Discrepancia tipo identidad: SAP (${row.tipo_identidad_sap}) vs SUNAT (${row.tipo_identidad_sunat})`);
    }

    // OBS 2: DIFERENCIA EN NUMERO DE IDENTIDAD
    if (row.nro_identidad_sap !== null && row.nro_identidad_sunat !== null && row.nro_identidad_sap !== row.nro_identidad_sunat) {
      errors.push("OBS 2: DIFERENCIA EN NUMERO DE IDENTIDAD");
      errors.push(`Discrepancia en identidad: SAP (${row.nro_identidad_sap}) vs SUNAT (${row.nro_identidad_sunat})`);
    }

    // OBS 6: NÚMERO DE IDENTIDAD SAP INCORRECTO
    if (row.tipo_identidad_sap !== null && row.nro_identidad_sap !== null) {
      if (!isValidIdentityNumber(row.tipo_identidad_sap, row.nro_identidad_sap)) {
        errors.push("OBS 6: NÚMERO DE IDENTIDAD SAP INCORRECTO");
        errors.push(`Identidad SAP no cumple con longitud/formato para tipo ${row.tipo_identidad_sap}: ${row.nro_identidad_sap}`);
      }
    }

    // OBS 7: NÚMERO DE IDENTIDAD SUNAT INCORRECTO
    if (row.tipo_identidad_sunat !== null && row.nro_identidad_sunat !== null) {
      if (!isValidIdentityNumber(row.tipo_identidad_sunat, row.nro_identidad_sunat)) {
        errors.push("OBS 7: NÚMERO DE IDENTIDAD SUNAT INCORRECTO");
        errors.push(`Identidad SUNAT no cumple con longitud/formato para tipo ${row.tipo_identidad_sunat}: ${row.nro_identidad_sunat}`);
      }
    }
  }

  // ERROR 6: BOLETAS MAYOR A 700 SOLES SIN DNI (Solo SUNAT como fuente)
  if (row.tipo_doc_pago === '03' && row.total_sunat > 700) {
    if (row.tipo_identidad_sunat !== '1') {
      errors.push("ERROR 6: BOLETAS MAYOR A 700 SOLES SIN DNI");
    }
  }



  // 8. Reglas de SIRE
  if (row.mensaje_sire) {
    const msgUpper = row.mensaje_sire.toUpperCase();
    
    // Regla de Cortesía: Opción A
    const key = `${row.tipo_doc_pago}-${row.serie}-${parseInt(row.correlativo, 10)}`;
    const hasCortesiasExcel = cortesiasSet.size > 0;
    const isCortesia = hasCortesiasExcel
      ? cortesiasSet.has(key)
      : row.total_sunat === 0 && (row.op_gratuitas > 0 || row.base_sap > 0);
    
    const diffBase = Math.abs(row.base_sap - row.base_sunat);
    const diffIgv = Math.abs(row.igv_sap - row.igv_sunat);
    const diffTotal = Math.abs(row.total_sap - row.total_sunat);

    if (msgUpper.includes('DIFERENCIA')) {
      if (isCortesia && diffBase <= 0.05 && diffIgv <= 0.05 && diffTotal <= 0.05) {
        // Correcto: Ignorar la diferencia en cortesías
      } else {
        errors.push(`SIRE Alerta: ${row.mensaje_sire}`);
      }
    } else if (msgUpper.includes('REGISTRO OK')) {
      // Registro validado
    } else {
      errors.push(`SIRE: ${row.mensaje_sire}`);
    }
  }

  // Determinar estado de validación en base a errores
  const hasError = errors.some(e => e.startsWith('ERROR '));
  const hasObs = errors.some(e => e.startsWith('OBS ') || e.startsWith('SIRE Alerta') || e.startsWith('SIRE:'));

  if (hasError) {
    status = 'ERROR';
  } else if (hasObs) {
    status = 'OBSERVADO';
  } else {
    status = 'OK';
  }

  return { status, errors };
}

// Conciliación principal
export function reconcileData(sapList, sunatList, sireList, rucEmpresa, cortesiasList = []) {
  const cortesiasSet = buildCortesiasSet(cortesiasList);
  const unified = {};

  // 1. Cargar SUNAT
  sunatList.forEach(item => {
    const key = item.car_sunat; // CAR directo de SUNAT
    unified[key] = {
      car_sunat: key,
      serie: item.serie,
      correlativo: item.correlativo,
      fecha_emision: item.fecha_emision,
      tipo_doc_pago: item.tipo_doc_pago,
      
      tipo_identidad_sunat: item.tipo_identidad,
      nro_identidad_sunat: item.nro_identidad,
      nombre_sunat: item.nombre,
      base_sunat: item.base,
      igv_sunat: item.igv,
      exonerado_sunat: item.exonerado || 0,
      inafecto_sunat: item.inafecto || 0,
      otros_sunat: item.otros,
      total_sunat: item.total,
      estado_sunat: item.estado,
      op_gratuitas: item.op_gratuitas,
      
      tipo_identidad_sap: null,
      nro_identidad_sap: null,
      nombre_sap: null,
      base_sap: 0,
      igv_sap: 0,
      exonerado_sap: 0,
      inafecto_sap: 0,
      otros_sap: 0,
      total_sap: 0,
      estado_sap: null,
      
      mensaje_sire: null,
      tipo_pago_sire: 'NORMAL',
      estado_validacion: 'OK',
      errores_json: []
    };
  });

  // 2. Cruzar con SAP (calculando el CAR en base al RUC)
  sapList.forEach(item => {
    const key = buildCarFromSAP(rucEmpresa, item.tipo_doc_pago, item.serie, item.correlativo);
    
    if (!unified[key]) {
      // Existe en SAP pero no en SUNAT
      unified[key] = {
        car_sunat: key,
        serie: item.serie,
        correlativo: item.correlativo,
        fecha_emision: item.fecha_emision,
        tipo_doc_pago: item.tipo_doc_pago,
        
        tipo_identidad_sunat: null,
        nro_identidad_sunat: null,
        nombre_sunat: null,
        base_sunat: 0,
        igv_sunat: 0,
        exonerado_sunat: 0,
        inafecto_sunat: 0,
        otros_sunat: 0,
        total_sunat: 0,
        estado_sunat: null,
        op_gratuitas: 0,
        
        tipo_identidad_sap: item.tipo_identidad,
        nro_identidad_sap: item.nro_identidad,
        nombre_sap: item.nombre,
        base_sap: item.base,
        igv_sap: item.igv,
        exonerado_sap: item.exonerado || 0,
        inafecto_sap: item.inafecto || 0,
        otros_sap: item.otros,
        total_sap: item.total,
        estado_sap: item.estado,
        
        mensaje_sire: null,
        tipo_pago_sire: 'NORMAL',
        estado_validacion: 'OK',
        errores_json: []
      };
    } else {
      const record = unified[key];
      record.tipo_identidad_sap = item.tipo_identidad;
      record.nro_identidad_sap = item.nro_identidad;
      record.nombre_sap = item.nombre;
      record.base_sap = item.base;
      record.igv_sap = item.igv;
      record.exonerado_sap = item.exonerado || 0;
      record.inafecto_sap = item.inafecto || 0;
      record.otros_sap = item.otros;
      record.total_sap = item.total;
      record.estado_sap = item.estado;
    }
  });

  // 3. Cruzar con SIRE
  sireList.forEach(s => {
    const carKey = s.car_archivo || s.car_sap;
    if (carKey && unified[carKey]) {
      unified[carKey].mensaje_sire = s.mensaje;
    }
  });

  // 4. Validaciones de fila individual
  Object.values(unified).forEach(record => {
    const getCortesiaKey = (r) =>
      `${r.tipo_doc_pago}-${r.serie}-${parseInt(r.correlativo, 10)}`;

    const hasCortesiasExcel = cortesiasSet.size > 0;
    const isCortesia = hasCortesiasExcel
      ? cortesiasSet.has(getCortesiaKey(record))
      : record.total_sunat === 0 && (record.op_gratuitas > 0 || record.base_sap > 0);

    if (isCortesia) {
      record.tipo_pago_sire = 'CORTESIA';
    }
    
    const val = validateRow(record, cortesiasSet);
    record.estado_validacion = val.status;
    record.errores_json = val.errors;
  });

  // 5. Validaciones de Secuencia Relacional Flexibilizada
  const groupedBySeries = {};
  Object.values(unified).forEach(r => {
    const groupKey = `${r.tipo_doc_pago}-${r.serie}`;
    if (!groupedBySeries[groupKey]) groupedBySeries[groupKey] = [];
    groupedBySeries[groupKey].push(r);
  });

  Object.values(groupedBySeries).forEach(list => {
    list.sort((a, b) => parseInt(a.correlativo, 10) - parseInt(b.correlativo, 10));
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const curr = list[i];

      // Si el documento actual está anulado, no se le aplican observaciones de secuencia ni fecha
      if (isRecordAnulado(curr)) {
        continue;
      }

      const prevNum = parseInt(prev.correlativo, 10);
      const currNum = parseInt(curr.correlativo, 10);
      
      // Salto de secuencia catalogado como OBSERVADO para admitir posibles anulados/excluidos
      if (currNum - prevNum > 1) {
        const gap = currNum - prevNum - 1;
        curr.errores_json.push('OBS 3: DIFERENCIA EN SECUENCIA DE CORRELATIVOS');
        curr.errores_json.push(`Posible salto de secuencia: ${gap} correlativo(s) no encontrado(s) entre ${prev.correlativo} y ${curr.correlativo} (pueden ser anulados)`);
        if (curr.estado_validacion !== 'ERROR') {
          curr.estado_validacion = 'OBSERVADO';
        }
      }
      
      // Fecha inconsistente (cronológica) catalogada como ERROR
      if (curr.fecha_emision && prev.fecha_emision && new Date(curr.fecha_emision) < new Date(prev.fecha_emision)) {
        curr.errores_json.push(`Fecha inconsistente: Folio ${curr.correlativo} (${curr.fecha_emision}) es previo a folio ${prev.correlativo} (${prev.fecha_emision})`);
        curr.estado_validacion = 'ERROR';
      }
    }
  });

  return Object.values(unified);
}
