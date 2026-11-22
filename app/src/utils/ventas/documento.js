// ============================================================================
// Normalización de comprobantes (Hoja "flujo" - sección 4.1).
// Se trabaja SIEMPRE con cadenas: nunca se convierten series/correlativos a
// número para no alterar los ceros a la izquierda del dato original.
// ============================================================================

/** Primer carácter de la serie -> código de tipo de comprobante (Tabla 10 SUNAT). */
export const TIPO_CP_POR_LETRA = { B: '03', F: '01' };

/** '1' -> '01', '3' -> '03'. Conserva cualquier otro valor tal cual. */
export function normalizarTipoCP(raw) {
  const s = String(raw ?? '').trim();
  return /^\d$/.test(s) ? `0${s}` : s;
}

/**
 * Forma canónica del correlativo SOLO para emparejar SAP vs SUNAT
 * (SAP exporta "0010131" y SUNAT "10131"). Se eliminan ceros a la izquierda
 * mediante manipulación de texto; el valor original se conserva aparte.
 */
export function correlativoCanonico(corr) {
  const s = String(corr ?? '').trim();
  return s.replace(/^0+(?=\d)/, '');
}

/** Identificador único del comprobante: tipo | serie | correlativo canónico. */
export function claveDocumento(tipo, serie, correlativo) {
  return `${normalizarTipoCP(tipo)}|${String(serie ?? '').trim().toUpperCase()}|${correlativoCanonico(correlativo)}`;
}

/** Comparación de correlativos numéricos sin conversión a Number (sin pérdida de precisión). */
export function compararCorrelativos(a, b) {
  const x = correlativoCanonico(a);
  const y = correlativoCanonico(b);
  if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
    if (x.length !== y.length) return x.length - y.length;
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return x.localeCompare(y);
}

/** Diferencia (b - a) entre correlativos numéricos usando BigInt. null si no son numéricos. */
export function diferenciaCorrelativos(a, b) {
  const x = correlativoCanonico(a);
  const y = correlativoCanonico(b);
  if (!/^\d+$/.test(x) || !/^\d+$/.test(y)) return null;
  return Number(BigInt(y) - BigInt(x));
}

/**
 * Normaliza un número de documento de 15 caracteres (formato del Excel de cortesías):
 *   - Carácter 1      : letra de la serie (B = Boleta '03', F = Factura '01')
 *   - Caracteres 4-6  : número de serie
 *   - Caracteres 7-15 : correlativo
 * Ej.: "B00805000010131" -> serie "B805", correlativo "000010131" (tipo '03').
 * La estructura se verifica ANTES de aplicar las posiciones.
 */
export function normalizarNumeroDocumento(doc) {
  const original = String(doc ?? '').trim();
  const res = {
    original, valido: false, motivo: null, letra: null, serieNumero: null,
    correlativo: null, serie: null, tipo_doc_pago: null, clave: null,
  };
  if (original.length !== 15) {
    res.motivo = `Longitud ${original.length}: se esperan 15 caracteres`;
    return res;
  }
  const letra = original[0].toUpperCase();
  if (!TIPO_CP_POR_LETRA[letra]) {
    res.motivo = `El primer carácter "${original[0]}" no es B (boleta) ni F (factura)`;
    return res;
  }
  if (!/^\d{14}$/.test(original.slice(1))) {
    res.motivo = 'Los caracteres 2 al 15 deben ser numéricos';
    return res;
  }
  res.letra = letra;
  res.serieNumero = original.slice(3, 6);
  res.correlativo = original.slice(6, 15);
  res.serie = `${letra}${res.serieNumero}`;
  res.tipo_doc_pago = TIPO_CP_POR_LETRA[letra];
  res.clave = claveDocumento(res.tipo_doc_pago, res.serie, res.correlativo);
  res.valido = true;
  return res;
}

/** Fecha dd/mm/aaaa -> aaaa-mm-dd. Devuelve null si no es válida o es 01/01/0001. */
export function normalizarFecha(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s === '01/01/0001') return { ok: true, value: null, vacio: true };
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) {
    const d = Number(m[1]); const mo = Number(m[2]); const y = Number(m[3]);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) {
      return { ok: true, value: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` };
    }
    return { ok: false, value: null };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: true, value: s };
  return { ok: false, value: null };
}

/** Folio legible: serie-correlativo (correlativo tal como figura en el sistema). */
export const folio = (serie, correlativo) => `${serie || '?'}-${correlativo ?? '?'}`;
