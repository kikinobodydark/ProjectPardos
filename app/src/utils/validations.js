import { normalizeDocType } from './parsers.js';

const allCharactersEqual = (str) => {
  if (!str) return false;
  return str.split('').every(char => char === str[0]);
};

// Generar CAR SUNAT desde los datos de SAP
export function buildCarFromSAP(rucEmpresa, tipo, serie, correlativo) {
  const tipoPad = normalizeDocType(tipo).padStart(2, '0');
  const corrPad = parseInt(correlativo, 10).toString().padStart(10, '0');
  return `${rucEmpresa}${tipoPad}${serie.trim().toUpperCase()}${corrPad}`;
}

export function validateRow(row) {
  const errors = [];
  let status = 'OK';

  const isAnulado = 
    row.estado_sap === '2' || 
    row.estado_sunat === '2' || 
    row.nombre_sap?.toUpperCase() === 'ANULADO';

  if (isAnulado) {
    return { status: 'OK', errors: ['Documento Anulado (validaciones omitidas)'] };
  }

  // Validaciones de Existencia
  if (row.total_sunat > 0 && !row.nro_identidad_sap && row.total_sap === 0) {
    return { status: 'ERROR', errors: ['No existe registro en SAP'] };
  }
  if (row.total_sap > 0 && !row.nro_identidad_sunat && row.total_sunat === 0) {
    return { status: 'ERROR', errors: ['No existe registro en SUNAT'] };
  }

  // 1. Validaciones de Longitud de Identidad
  const valIdent = (tipo, nro, label) => {
    if (!nro) return;
    const cleanNro = nro.trim();
    if (tipo === '1') { // DNI
      if (cleanNro.length !== 8 || !/^\d+$/.test(cleanNro)) {
        errors.push(`${label} DNI debe tener exactamente 8 caracteres numéricos`);
        status = 'ERROR';
      }
    } else if (tipo === '6') { // RUC
      if (cleanNro.length !== 11 || !/^\d+$/.test(cleanNro)) {
        errors.push(`${label} RUC debe tener exactamente 11 caracteres numéricos`);
        status = 'ERROR';
      }
    } else if (tipo === '0') { // Otros
      if (cleanNro.length > 15) {
        errors.push(`${label} Identidad Otro excede la longitud de 15 caracteres`);
        status = 'ERROR';
      }
    } else if (tipo === '4') { // CE
      if (cleanNro.length > 12) {
        errors.push(`${label} Identidad CE excede la longitud de 12 caracteres`);
        status = 'ERROR';
      }
    } else if (tipo === '7') { // Pasaporte
      if (cleanNro.length > 12) {
        errors.push(`${label} Pasaporte excede la longitud de 12 caracteres`);
        status = 'ERROR';
      }
    }
  };

  valIdent(row.tipo_identidad_sunat, row.nro_identidad_sunat, 'SUNAT');

  // 2. Boleta + monto > 700 soles -> tipo identidad debe ser 1 (DNI)
  if (row.tipo_doc_pago === '03' && row.total_sunat > 700) {
    if (row.tipo_identidad_sunat !== '1') {
      errors.push('Boleta mayor a S/. 700 requiere DNI (Código 1)');
      status = 'ERROR';
    }
  }

  // 3. Tipo identidad 1 (DNI) -> no números iguales y nombre distinto a 'cliente'
  if (row.tipo_identidad_sunat === '1' && row.nro_identidad_sunat) {
    if (allCharactersEqual(row.nro_identidad_sunat)) {
      errors.push('DNI no puede contener todos los dígitos iguales');
      status = 'ERROR';
    }
    
    // Regla de Nombre "Cliente" refinada para evitar falsos positivos
    const nombreLower = row.nombre_sunat?.toLowerCase().trim() ?? '';
    if (nombreLower === 'cliente' || nombreLower.startsWith('cliente ')) {
      errors.push('Nombre genérico "cliente" no permitido para DNI');
      status = 'ERROR';
    }
  }

  // 4. Boleta + tipo identidad 6 (RUC) -> primeros caracteres deben ser 10
  if (row.tipo_doc_pago === '03' && row.tipo_identidad_sunat === '6') {
    if (!row.nro_identidad_sunat?.startsWith('10')) {
      errors.push('Boletas con RUC deben iniciar con "10" (RUC Persona Natural)');
      status = 'ERROR';
    }
  }

  // 5. Tipo documento 4 (CE) -> no caracteres iguales y nombre distinto a 'cliente'
  if (row.tipo_identidad_sunat === '4' && row.nro_identidad_sunat) {
    if (allCharactersEqual(row.nro_identidad_sunat)) {
      errors.push('CE no puede contener caracteres todos iguales');
      status = 'ERROR';
    }
    const nombreLower = row.nombre_sunat?.toLowerCase().trim() ?? '';
    if (nombreLower === 'cliente' || nombreLower.startsWith('cliente ')) {
      errors.push('Nombre genérico "cliente" no permitido para CE');
      status = 'ERROR';
    }
  }

  // 6. Comparación SAP vs SUNAT de Identidad
  if (row.nro_identidad_sap && row.nro_identidad_sunat) {
    if (row.nro_identidad_sap !== row.nro_identidad_sunat) {
      errors.push(`Discrepancia en identidad: SAP (${row.nro_identidad_sap}) vs SUNAT (${row.nro_identidad_sunat})`);
      status = 'ERROR';
    }
    if (row.tipo_identidad_sap !== row.tipo_identidad_sunat) {
      errors.push(`Discrepancia tipo identidad: SAP (${row.tipo_identidad_sap}) vs SUNAT (${row.tipo_identidad_sunat})`);
      status = 'OBSERVADO';
    }
  }

  // 7. Diferencia en importes monetarios SAP vs SUNAT (Tolerancia +/- 0.05)
  const diffBase = Math.abs(row.base_sap - row.base_sunat);
  const diffIgv = Math.abs(row.igv_sap - row.igv_sunat);
  const diffOtros = Math.abs(row.otros_sap - row.otros_sunat);
  const diffTotal = Math.abs(row.total_sap - row.total_sunat);

  if (diffBase > 0.05 || diffIgv > 0.05 || diffOtros > 0.05 || diffTotal > 0.05) {
    errors.push(`Diferencia de importes SAP vs SUNAT: Base(${diffBase.toFixed(2)}), IGV(${diffIgv.toFixed(2)}), Otros(${diffOtros.toFixed(2)}), Total(${diffTotal.toFixed(2)})`);
    status = 'ERROR';
  }

  // 8. Reglas de SIRE
  if (row.mensaje_sire) {
    const msgUpper = row.mensaje_sire.toUpperCase();
    
    // Regla Cortesía: Si el total es 0 y op_gratuitas > 0 (o base_sap > 0)
    const isCortesia = row.total_sunat === 0 && (row.op_gratuitas > 0 || row.base_sap > 0);
    
    if (msgUpper.includes('DIFERENCIA')) {
      if (isCortesia && diffBase <= 0.05 && diffIgv <= 0.05 && diffOtros <= 0.05 && diffTotal <= 0.05) {
        // Correcto: Ignorar la diferencia en cortesías
      } else {
        errors.push(`SIRE Alerta: ${row.mensaje_sire}`);
        if (status === 'OK') status = 'OBSERVADO';
      }
    } else if (msgUpper.includes('REGISTRO OK')) {
      // Registro validado
    } else {
      errors.push(`SIRE: ${row.mensaje_sire}`);
      if (status === 'OK') status = 'OBSERVADO';
    }
  }

  return { status, errors };
}

// Conciliación principal
export function reconcileData(sapList, sunatList, sireList, rucEmpresa) {
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
      otros_sunat: item.otros,
      total_sunat: item.total,
      estado_sunat: item.estado,
      op_gratuitas: item.op_gratuitas,
      
      tipo_identidad_sap: null,
      nro_identidad_sap: null,
      nombre_sap: null,
      base_sap: 0,
      igv_sap: 0,
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
        otros_sunat: 0,
        total_sunat: 0,
        estado_sunat: null,
        op_gratuitas: 0,
        
        tipo_identidad_sap: item.tipo_identidad,
        nro_identidad_sap: item.nro_identidad,
        nombre_sap: item.nombre,
        base_sap: item.base,
        igv_sap: item.igv,
        otros_sap: item.otros,
        total_sap: item.total,
        estado_sap: item.estado,
        
        mensaje_sire: null,
        tipo_pago_sire: 'NORMAL',
        estado_validacion: 'ERROR',
        errores_json: ['Existe en SAP pero no registrado en SUNAT']
      };
    } else {
      const record = unified[key];
      record.tipo_identidad_sap = item.tipo_identidad;
      record.nro_identidad_sap = item.nro_identidad;
      record.nombre_sap = item.nombre;
      record.base_sap = item.base;
      record.igv_sap = item.igv;
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
    const isCortesia = record.total_sunat === 0 && (record.op_gratuitas > 0 || record.base_sap > 0);
    if (isCortesia) {
      record.tipo_pago_sire = 'CORTESIA';
    }
    
    if (record.errores_json.length > 0) return;

    const val = validateRow(record);
    record.estado_validacion = val.status;
    record.errores_json = val.errors;
  });

  // 5. Validaciones de Secuencia Relacional Flexibilizada
  const groupedBySeries = {};
  Object.values(unified).forEach(r => {
    if (r.estado_sunat === '2' || r.estado_sap === '2') return;
    const groupKey = `${r.tipo_doc_pago}-${r.serie}`;
    if (!groupedBySeries[groupKey]) groupedBySeries[groupKey] = [];
    groupedBySeries[groupKey].push(r);
  });

  Object.values(groupedBySeries).forEach(list => {
    list.sort((a, b) => parseInt(a.correlativo, 10) - parseInt(b.correlativo, 10));
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const curr = list[i];
      const prevNum = parseInt(prev.correlativo, 10);
      const currNum = parseInt(curr.correlativo, 10);
      
      // Salto de secuencia catalogado como OBSERVADO para admitir posibles anulados/excluidos
      if (currNum - prevNum > 1) {
        const gap = currNum - prevNum - 1;
        curr.errores_json.push(`Posible salto de secuencia: ${gap} correlativo(s) no encontrado(s) entre ${prev.correlativo} y ${curr.correlativo} (pueden ser anulados)`);
        if (curr.estado_validacion !== 'ERROR') {
          curr.estado_validacion = 'OBSERVADO';
        }
      }
      
      // Fecha inconsistente (cronológica) catalogada como ERROR
      if (new Date(curr.fecha_emision) < new Date(prev.fecha_emision)) {
        curr.errores_json.push(`Fecha inconsistente: Folio ${curr.correlativo} (${curr.fecha_emision}) es previo a folio ${prev.correlativo} (${prev.fecha_emision})`);
        curr.estado_validacion = 'ERROR';
      }
    }
  });

  return Object.values(unified);
}
