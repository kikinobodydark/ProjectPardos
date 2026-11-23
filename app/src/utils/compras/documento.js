// ============================================================================
// Normalización y clave única de identificación para el módulo de Compras.
// CLAVE DE VALIDACIÓN:
//   RUC DEL PROVEEDOR + CÓDIGO DE TIPO DE DOCUMENTO + SERIE + CORRELATIVO
//
// Consideraciones implementadas:
//  - Elimina espacios innecesarios.
//  - Conserva SIEMPRE los ceros a la izquierda de series y correlativos en los
//    datos normalizados y visibles (nunca convierte a Number).
//  - Estandariza los campos antes de concatenar para evitar falsos duplicados
//    o falsos inexistentes entre SAP y SUNAT.
// ============================================================================
import { normalizarFecha } from '../ventas/documento.js';

export { normalizarFecha };

/** Elimina espacios innecesarios (inicio, fin e internos) y estandariza a mayúsculas. */
export function limpiarTextoClave(raw) {
  return String(raw ?? '').trim().replace(/\s+/g, '').toUpperCase();
}

/** Limpia texto descriptivo (razón social) colapsando espacios redundantes. */
export function limpiarTextoDescriptivo(raw) {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * Estandariza el código de tipo de documento a 2 dígitos si es numérico de 1 dígito:
 *  '1' -> '01', '7' -> '07', '9' -> '09', '14' -> '14'.
 * Conserva cualquier otro código limpio sin espacios.
 */
export function normalizarTipoDocCompras(raw) {
  const s = limpiarTextoClave(raw);
  if (!s) return '';
  if (/^\d+$/.test(s)) {
    const sinCeros = s.replace(/^0+(?=\d)/, '');
    return sinCeros.length === 1 ? `0${sinCeros}` : sinCeros;
  }
  return s;
}

/**
 * Normaliza el código de tipo de documento de identidad (Tabla 2 SUNAT).
 * Ej.: '06' -> '6', ' 6 ' -> '6', '1' -> '1', '0' -> '0'.
 */
export function normalizarTipoIdentidad(raw) {
  const s = limpiarTextoClave(raw);
  if (!s) return '';
  if (/^\d+$/.test(s)) {
    return s.replace(/^0+(?=\d)/, '');
  }
  return s;
}

/**
 * Normaliza el número de documento de identidad / RUC del proveedor.
 * Elimina espacios innecesarios pero conserva el valor textual exacto.
 */
export function normalizarRucProveedor(raw) {
  return limpiarTextoClave(raw);
}

/**
 * Normaliza la serie conservando los ceros a la izquierda (ej. '0001', 'F001').
 */
export function normalizarSerieCompras(raw) {
  return limpiarTextoClave(raw);
}

/**
 * Normaliza el correlativo conservando sus ceros a la izquierda originales
 * (ej. '00012345' se mantiene como '00012345').
 */
export function normalizarCorrelativoCompras(raw) {
  return limpiarTextoClave(raw);
}

/**
 * Correlativo estandarizado para la clave de cruce entre SAP y SUNAT:
 * Si es puramente numérico, estandariza con ceros a la izquierda a 10 dígitos
 * (o mantiene su longitud si ya supera 10) para que "0001234" y "1234" o
 * "0000001234" coincidan sin generar falsos inexistentes ni perder ceros.
 */
export function correlativoParaClave(raw) {
  const clean = normalizarCorrelativoCompras(raw);
  if (!clean) return '';
  if (/^\d+$/.test(clean)) {
    const sinCeros = clean.replace(/^0+(?=\d)/, '');
    return sinCeros.length >= 10 ? sinCeros : sinCeros.padStart(10, '0');
  }
  return clean;
}

/**
 * Construye la clave única canónica de emparejamiento SAP vs SUNAT:
 *   RUC_PROVEEDOR | TIPO_DOC | SERIE | CORRELATIVO_ESTANDARIZADO
 */
export function construirClaveCompras(rucProveedor, tipoDoc, serie, correlativo) {
  const ruc = normalizarRucProveedor(rucProveedor);
  const tipo = normalizarTipoDocCompras(tipoDoc);
  const ser = normalizarSerieCompras(serie);
  const corr = correlativoParaClave(correlativo);
  return `${ruc}|${tipo}|${ser}|${corr}`;
}

/**
 * Construye la clave de validación legible (conservando ceros originales de serie y correlativo):
 *   RUC-TIPO-SERIE-CORRELATIVO
 */
export function construirClaveLegible(rucProveedor, tipoDoc, serie, correlativo) {
  const ruc = normalizarRucProveedor(rucProveedor) || 'SIN_RUC';
  const tipo = normalizarTipoDocCompras(tipoDoc) || '??';
  const ser = normalizarSerieCompras(serie) || 'SIN_SERIE';
  const corr = normalizarCorrelativoCompras(correlativo) || 'SIN_CORR';
  return `${ruc}-${tipo}-${ser}-${corr}`;
}

/**
 * Construye el valor `car_sunat` (máximo 30 caracteres para columna VARCHAR(30)
 * con constraint UNIQUE (periodo_id, car_sunat) en public.detalle_compras).
 * Si la concatenación directa excede 30 caracteres, usa un hash determinista FNV-1a
 * de 8 caracteres hexadecimales para garantizar unicidad sin truncamiento colisionable.
 */
export function construirCarBDCompras(rucProveedor, tipoDoc, serie, correlativo) {
  const ruc = normalizarRucProveedor(rucProveedor);
  const tipo = normalizarTipoDocCompras(tipoDoc);
  const ser = normalizarSerieCompras(serie);
  const corr = correlativoParaClave(correlativo);
  const directo = `${ruc}${tipo}${ser}${corr}`;
  if (directo.length <= 30) return directo;

  // Hash FNV-1a 32-bit determinista para claves largas (ej. proveedores extranjeros)
  const full = `${ruc}|${tipo}|${ser}|${corr}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < full.length; i++) {
    h ^= full.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const suffix = (h >>> 0).toString(16).padStart(8, '0').toUpperCase();
  return `${directo.slice(0, 21)}_${suffix}`;
}

/** Comparación natural de correlativos preservando texto y ceros a la izquierda. */
export function compararCorrelativosCompras(a, b) {
  const ca = normalizarCorrelativoCompras(a);
  const cb = normalizarCorrelativoCompras(b);
  if (/^\d+$/.test(ca) && /^\d+$/.test(cb)) {
    const xa = ca.replace(/^0+(?=\d)/, '');
    const xb = cb.replace(/^0+(?=\d)/, '');
    if (xa.length !== xb.length) return xa.length - xb.length;
    return xa < xb ? -1 : xa > xb ? 1 : 0;
  }
  return ca.localeCompare(cb);
}
