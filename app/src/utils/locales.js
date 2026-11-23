// ============================================================================
// Utilidades puras para Locales y Series por Empresa (sin dependencias de React
// ni Supabase, reutilizable en UI, reportes, Web Workers y pruebas Node).
// ============================================================================

export const TIPOS_SERIE_LOCAL = [
  { codigo: '01', label: 'Serie Factura', corto: 'Factura (01)', placeholder: 'Ej: F635, F611' },
  { codigo: '03', label: 'Serie Boleta', corto: 'Boleta (03)', placeholder: 'Ej: B635, B611' },
  { codigo: '07', label: 'Serie Nota de Crédito', corto: 'N. Crédito (07)', placeholder: 'Ej: BC01, FC01' },
  { codigo: '08', label: 'Serie Nota de Débito', corto: 'N. Débito (08)', placeholder: 'Ej: BD01, FD01' },
];

/** Normaliza el texto de una serie a mayúsculas sin espacios ni caracteres inválidos. */
export function normalizarSerie(raw) {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10);
}

/**
 * Normaliza la respuesta de `locales_empresa` + `local_series` en una estructura
 * cómoda para tablas, formularios y filtros rápidos.
 */
export function normalizarLocales(rows = []) {
  return (rows || []).map((loc) => {
    const rawSeries = Array.isArray(loc.local_series) ? loc.local_series : [];
    const seriesPorTipo = { '01': [], '03': [], '07': [], '08': [] };
    const todasSeries = [];
    const clavesTipoSerie = new Set();
    const seriesSet = new Set();

    for (const s of rawSeries) {
      const serieNorm = normalizarSerie(s.serie);
      const tipo = String(s.tipo_doc_pago || '').trim();
      if (!serieNorm) continue;
      if (seriesPorTipo[tipo]) {
        seriesPorTipo[tipo].push(serieNorm);
      }
      todasSeries.push({ id: s.id, tipo_doc_pago: tipo, serie: serieNorm });
      clavesTipoSerie.add(`${tipo}|${serieNorm}`);
      seriesSet.add(serieNorm);
    }

    for (const k of Object.keys(seriesPorTipo)) {
      seriesPorTipo[k].sort((a, b) => a.localeCompare(b));
    }
    todasSeries.sort((a, b) => a.tipo_doc_pago.localeCompare(b.tipo_doc_pago) || a.serie.localeCompare(b.serie));

    return {
      id: loc.id,
      empresa_id: loc.empresa_id,
      nombre: loc.nombre,
      activo: loc.activo !== false,
      series: todasSeries,
      seriesPorTipo,
      seriesSet,
      clavesTipoSerie,
      resumenSeries: [...seriesSet].sort((a, b) => a.localeCompare(b)).join(', '),
    };
  });
}

/**
 * Construye mapas de búsqueda rápida para saber a qué local pertenece un
 * comprobante (priorizando coincidencia exacta `tipo_doc_pago|serie` y luego `serie`).
 */
export function construirIndiceLocales(locales = []) {
  const porTipoSerie = new Map();
  const porSerie = new Map();
  const localesActivos = locales.filter((l) => l.activo !== false);

  for (const loc of localesActivos) {
    for (const s of loc.series || []) {
      porTipoSerie.set(`${s.tipo_doc_pago}|${s.serie}`, loc);
      if (!porSerie.has(s.serie)) {
        porSerie.set(s.serie, loc);
      }
    }
  }

  return {
    localesActivos,
    obtenerLocal(serie, tipoDoc) {
      const s = normalizarSerie(serie);
      if (!s) return null;
      if (tipoDoc) {
        const exact = porTipoSerie.get(`${String(tipoDoc).trim()}|${s}`);
        if (exact) return exact;
      }
      return porSerie.get(s) || null;
    },
    tieneAlgunaSerieAsignada(serie, tipoDoc) {
      return !!this.obtenerLocal(serie, tipoDoc);
    },
  };
}

/** Evalúa si un documento o salto pertenece al local seleccionado (`ALL`, `SIN_LOCAL`, o `local.id`). */
export function coincideConLocal(item, localId, indiceLocales) {
  if (!localId || localId === 'ALL') return true;
  if (!indiceLocales || indiceLocales.localesActivos.length === 0) return true;
  const localDoc = indiceLocales.obtenerLocal(item?.serie, item?.tipo_doc_pago);
  if (localId === 'SIN_LOCAL') return !localDoc;
  return localDoc?.id === localId;
}
