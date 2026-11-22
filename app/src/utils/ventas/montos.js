// ============================================================================
// Utilidades monetarias del módulo de Ventas.
// Todos los importes se manejan internamente en CÉNTIMOS ENTEROS para evitar
// errores de precisión de punto flotante (ej. 0.1 + 0.2 !== 0.3).
// ============================================================================

/** Tolerancia máxima permitida entre SAP y SUNAT: S/ 0.05 = 5 céntimos. */
export const TOLERANCIA_CENTIMOS = 5;

/**
 * Convierte un texto con importe ("1,234.56", "-12.5", "0") a céntimos enteros.
 * No usa parseFloat para evitar pérdidas de precisión.
 * @returns {{ ok: boolean, value: number, vacio?: boolean }}
 */
export function parseMontoCentimos(raw) {
  if (raw === null || raw === undefined) return { ok: true, value: 0, vacio: true };
  let s = String(raw).trim();
  if (s === '') return { ok: true, value: 0, vacio: true };
  s = s.replace(/,/g, '').replace(/\s/g, '');
  const m = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === '' && !m[3])) return { ok: false, value: 0 };
  const signo = m[1] === '-' ? -1 : 1;
  const entero = Number(m[2] || '0');
  const dec = (m[3] || '').padEnd(3, '0');
  let centimos = entero * 100 + Number(dec.slice(0, 2));
  // Redondeo half-up con el tercer decimal
  if (Number(dec[2]) >= 5) centimos += 1;
  return { ok: Number.isSafeInteger(centimos), value: signo * centimos };
}

/** Céntimos -> número decimal con 2 decimales (para persistir en NUMERIC(15,2)). */
export const centimosADecimal = (c) => Number(((c || 0) / 100).toFixed(2));

/** Número decimal (desde BD) -> céntimos enteros. */
export const decimalACentimos = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  return Math.round(Number(v) * 100);
};

const fmt = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Formatea céntimos como importe legible: 1234.5 -> "1,234.50". */
export const formatoMonto = (c) => (c === null || c === undefined ? '—' : fmt.format((c || 0) / 100));

/** Diferencia absoluta dentro de tolerancia. */
export const dentroDeTolerancia = (difCentimos) => Math.abs(difCentimos) <= TOLERANCIA_CENTIMOS;
