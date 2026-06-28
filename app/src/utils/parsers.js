// Normalizar valores de importes numéricos
const parseAmount = (val) => {
  if (!val) return 0;
  const cleaned = val.trim().replace(/,/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
};

// Normalizar tipos de documento ('1' -> '01', '3' -> '03', etc.)
export const normalizeDocType = (val) => {
  if (!val) return '';
  const clean = val.trim();
  return clean.length === 1 ? `0${clean}` : clean;
};

// Normalizar Fechas
const normalizeDate = (val) => {
  if (!val || val.includes('01/01/0001')) return null;
  const clean = val.trim();
  const parts = clean.split('/');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }
  const dotParts = clean.split('.');
  if (dotParts.length === 3) {
    return `${dotParts[2]}-${dotParts[1].padStart(2, '0')}-${dotParts[0].padStart(2, '0')}`;
  }
  return clean;
};

// Función para remover el BOM en UTF-8
export const stripBOM = (text) => {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
};

// Parser SAP
export function parseSAP(text) {
  const lines = text.split('\n');
  const results = [];
  for (let line of lines) {
    if (!line.trim()) continue;
    const cols = line.split('|');
    if (cols.length < 25) continue;
    
    results.push({
      periodo: cols[0].trim(),
      doc_interno: cols[1].trim(),
      sociedad: cols[2].trim(),
      fecha_emision: normalizeDate(cols[3]),
      tipo_doc_pago: normalizeDocType(cols[5]),
      serie: cols[6].trim().toUpperCase(),
      correlativo: cols[7].trim(),
      tipo_identidad: cols[9].trim(),
      nro_identidad: cols[10].trim(),
      nombre: cols[11].trim(),
      base: parseAmount(cols[13]),
      igv: parseAmount(cols[15]),
      otros: parseAmount(cols[23]), // Mapea conceptualmente a "Otros Tributos"
      total: parseAmount(cols[24]),
      estado: cols[34]?.trim() || '1' // 1 = activo, 2 = anulado
    });
  }
  return results;
}

// Parser SUNAT
export function parseSUNAT(text) {
  const lines = text.split('\n');
  const results = [];
  let isHeader = true;
  for (let line of lines) {
    if (!line.trim()) continue;
    if (isHeader) {
      isHeader = false;
      continue;
    }
    const cols = line.split('|');
    if (cols.length < 26) continue;
    
    results.push({
      ruc_empresa: cols[0].trim(),
      periodo: cols[2].trim(),
      car_sunat: cols[3].trim(),
      fecha_emision: normalizeDate(cols[4]),
      tipo_doc_pago: normalizeDocType(cols[6]),
      serie: cols[7].trim().toUpperCase(),
      correlativo: cols[8].trim(),
      tipo_identidad: cols[10].trim(),
      nro_identidad: cols[11].trim(),
      nombre: cols[12].trim(),
      base: parseAmount(cols[14]),
      igv: parseAmount(cols[16]),
      otros: parseAmount(cols[24]), // Otros Tributos (incl. ICBPER)
      total: parseAmount(cols[25]), // Total CP
      estado: cols[34]?.trim() || '1', // 1 = activo, 2 = anulado
      op_gratuitas: parseAmount(cols[36])
    });
  }
  return results;
}

// Parser SIRE
export function parseSIRE(text) {
  const lines = text.split('\n');
  const results = [];
  let isHeader = true;
  for (let line of lines) {
    if (!line.trim()) continue;
    if (isHeader) {
      isHeader = false;
      continue;
    }
    const cols = line.split('|');
    if (cols.length < 6) continue;
    
    results.push({
      ejercicio: cols[0].trim(),
      sociedad: cols[1].trim(),
      fecha_sap: normalizeDate(cols[2]),
      car_sap: cols[3].trim(),
      car_archivo: cols[4].trim(),
      mensaje: cols[5].trim()
    });
  }
  return results;
}
