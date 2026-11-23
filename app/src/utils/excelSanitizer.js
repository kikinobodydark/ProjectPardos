// ============================================================================
// Sanitización pura contra CSV / Excel Formula Injection (=, +, -, @, Tab, CR).
// Sin dependencias de Supabase ni navegador para reutilizarse en Workers y tests.
// ============================================================================

export function sanitizeExcelCell(val) {
  if (typeof val !== 'string') return val;
  if (/^[=+\-@\t\r]/.test(val)) {
    return `'${val}`;
  }
  return val;
}

export function sanitizeExcelRow(rowObj) {
  if (!rowObj || typeof rowObj !== 'object') return rowObj;
  const clean = {};
  for (const [k, v] of Object.entries(rowObj)) {
    clean[k] = sanitizeExcelCell(v);
  }
  return clean;
}
