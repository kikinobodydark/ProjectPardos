// ============================================================================
// Vista principal de Validación y Conciliación del módulo de Ventas.
// - Esqueleto de carga (SkeletonTable)
// - Virtualización de listas largas (useVirtualList) para 50, 100, 250, 500 filas
// - Filas memoizadas (React.memo) para evitar renderizados innecesarios
// - Tamaño de página adaptativo para móviles y redes lentas
// ============================================================================
import React, { useState, useEffect, useMemo, useCallback, memo } from 'react';
import {
  FiDownload, FiSearch, FiEye, FiFilter,
  FiList, FiBarChart2, FiChevronDown, FiAlertCircle, FiRefreshCw,
} from 'react-icons/fi';
import { useDocumentosVentas } from './useDocumentosVentas';
import { useLocalesEmpresa, coincideConLocal } from '../../utils/useLocalesEmpresa';
import ModalDetalleDocumentoVentas from './ModalDetalleDocumentoVentas';
import ReportesEspecificosVentas from './ReportesEspecificosVentas';
import PanelSaltosSecuenciaVentas from './PanelSaltosSecuenciaVentas';
import SelectorLocal from '../SelectorLocal';
import { SkeletonTable } from '../SkeletonLoader';
import { useVirtualList } from '../../utils/useVirtualList';
import { useNetworkProfile } from '../../utils/networkProfile';
import {
  INCIDENCIAS, ESTADOS, descripcionTipoCP,
} from '../../utils/ventas/catalogos';
import {
  FILTROS_INICIALES, filtrarDocumentos, calcularIndicadores, calcularSecuencias, exportarExcelVentas,
} from '../../utils/ventas/reportes';
import { formatoMonto, dentroDeTolerancia } from '../../utils/ventas/montos';

const FilaDocumentoVenta = memo(function FilaDocumentoVenta({
  d,
  onSelectDoc,
  onFilterEstado,
  onFilterCodigo,
}) {
  const est = ESTADOS[d.estado] || ESTADOS.OK;
  const ambos = d.en_sap && d.en_sunat;
  const diffTipoId = ambos && d.sap.tipo_identidad !== d.sunat.tipo_identidad;
  const diffNroId = ambos && d.sap.nro_identidad !== d.sunat.nro_identidad;
  const diffBase = ambos && !dentroDeTolerancia(d.sap.base - d.sunat.base);
  const diffIgv = ambos && !dentroDeTolerancia(d.sap.igv - d.sunat.igv);
  const diffOtros = ambos && !dentroDeTolerancia(d.sap.otros - d.sunat.otros);
  const diffTotal = ambos && !dentroDeTolerancia(d.sap.total - d.sunat.total);
  const difTotalVal = ambos ? d.sap.total - d.sunat.total : null;

  return (
    <tr
      style={{ cursor: 'pointer' }}
      onClick={() => onSelectDoc(d)}
      title="Haga clic para ver el detalle comparativo SAP vs. SUNAT"
    >
      <td className="font-mono fw-bold">
        {d.serie}-{d.correlativo}
      </td>
      <td className="font-mono">{d.fecha_emision || '—'}</td>
      <td>{descripcionTipoCP(d.tipo_doc_pago)}</td>

      {/* Identidad SAP (4, 5, 6) */}
      <td className={`font-mono ${!d.en_sap || diffTipoId ? 'cell-mismatch' : ''}`}>
        {d.en_sap ? (d.sap.tipo_identidad || '—') : 'NO EXISTE'}
      </td>
      <td className={`font-mono ${diffNroId ? 'cell-mismatch' : ''}`}>
        {d.en_sap ? (d.sap.nro_identidad || '—') : '—'}
      </td>
      <td className="text-truncate" style={{ maxWidth: '150px' }} title={d.sap?.nombre}>
        {d.en_sap ? (d.sap.nombre || '—') : <span className="text-muted">(Sin registro SAP)</span>}
      </td>

      {/* Identidad SUNAT (7, 8, 9) */}
      <td className={`font-mono ${!d.en_sunat || diffTipoId ? 'cell-mismatch' : ''}`}>
        {d.en_sunat ? (d.sunat.tipo_identidad || '—') : 'NO EXISTE'}
      </td>
      <td className={`font-mono ${diffNroId ? 'cell-mismatch' : ''}`}>
        {d.en_sunat ? (d.sunat.nro_identidad || '—') : '—'}
      </td>
      <td className="text-truncate" style={{ maxWidth: '150px' }} title={d.sunat?.nombre}>
        {d.en_sunat ? (d.sunat.nombre || '—') : <span className="text-muted">(Sin registro SUNAT)</span>}
      </td>

      {/* Importes (10 - 18) con marcado visual por par SAP vs SUNAT */}
      <td className={`text-end font-mono col-group-bi col-pair-start ${diffBase ? 'cell-mismatch' : ''}`}>
        {d.en_sap ? formatoMonto(d.sap.base) : '—'}
      </td>
      <td className={`text-end font-mono col-group-bi col-pair-end ${diffBase ? 'cell-mismatch' : 'cell-match'}`}>
        {d.en_sunat ? formatoMonto(d.sunat.base) : '—'}
      </td>

      <td className={`text-end font-mono col-group-igv col-pair-start ${diffIgv ? 'cell-mismatch' : ''}`}>
        {d.en_sap ? formatoMonto(d.sap.igv) : '—'}
      </td>
      <td className={`text-end font-mono col-group-igv col-pair-end ${diffIgv ? 'cell-mismatch' : 'cell-match'}`}>
        {d.en_sunat ? formatoMonto(d.sunat.igv) : '—'}
      </td>

      <td className={`text-end font-mono col-group-otros col-pair-start ${diffOtros ? 'cell-mismatch' : ''}`}>
        {d.en_sap ? formatoMonto(d.sap.otros) : '—'}
      </td>
      <td className={`text-end font-mono col-group-otros col-pair-end ${diffOtros ? 'cell-mismatch' : 'cell-match'}`}>
        {d.en_sunat ? formatoMonto(d.sunat.otros) : '—'}
      </td>

      <td className={`text-end font-mono fw-semibold col-group-total col-pair-start ${diffTotal ? 'cell-mismatch' : ''}`}>
        {d.en_sap ? formatoMonto(d.sap.total) : '—'}
      </td>
      <td className={`text-end font-mono fw-semibold col-group-total col-pair-end ${diffTotal ? 'cell-mismatch' : 'cell-match'}`}>
        {d.en_sunat ? formatoMonto(d.sunat.total) : '—'}
      </td>

      <td className={`text-end font-mono ${diffTotal ? 'cell-mismatch' : 'text-muted'}`}>
        {difTotalVal === null ? '—' : formatoMonto(difTotalVal)}
      </td>

      {/* 19. Estado */}
      <td
        className="text-center"
        onClick={(e) => {
          e.stopPropagation();
          onFilterEstado(d.estado);
        }}
      >
        <span className={`badge badge-status badge-status-${est.clase}`}>
          {est.etiqueta}
        </span>
      </td>

      {/* 20. Incidencias */}
      <td>
        <div className="d-flex align-items-center justify-content-between gap-1">
          <div className="d-flex flex-wrap gap-1">
            {d.codigos.length === 0 ? (
              <span className="text-success" style={{ fontSize: '0.73rem' }}>
                {d.anulado ? 'Anulado' : 'Sin incidencias'}
              </span>
            ) : (
              d.codigos.map((cod) => (
                <span
                  key={cod}
                  className={`badge badge-status badge-status-${cod.startsWith('ERROR') ? 'error' : 'observado'}`}
                  style={{ cursor: 'pointer', fontSize: '0.67rem' }}
                  title="Clic para filtrar por esta incidencia"
                  onClick={(e) => {
                    e.stopPropagation();
                    onFilterCodigo(cod);
                  }}
                >
                  {cod}
                </span>
              ))
            )}
          </div>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary p-1 border-0 flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onSelectDoc(d);
            }}
            title="Ver detalle comparativo SAP vs. SUNAT"
          >
            <FiEye />
          </button>
        </div>
      </td>
    </tr>
  );
});

const ConciliacionVentas = memo(function ConciliacionVentas({
  periodId, activePeriod, initialFilter, onFilterReset, activeCompany,
  selectedLocalId = 'ALL', onChangeLocalId,
}) {
  const { data: todosDocs = [], isLoading } = useDocumentosVentas(periodId, true);
  const { localesActivos, indiceLocales, isFetched: localesFetched, isLoading: localesLoading } = useLocalesEmpresa(activeCompany?.id, true);
  const networkProfile = useNetworkProfile();

  const [filtros, setFiltros] = useState(FILTROS_INICIALES);
  const [busquedaInput, setBusquedaInput] = useState('');
  const [vistaActiva, setVistaActiva] = useState('tabla');
  const [reporteInicial, setReporteInicial] = useState('resumen');
  const [mostrarMenuExportar, setMostrarMenuExportar] = useState(false);
  const [docSeleccionado, setDocSeleccionado] = useState(null);
  const [ocultarSinIncidencias, setOcultarSinIncidencias] = useState(false);

  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(() => networkProfile.recommendedPageSize || 20);

  // Debounce de búsqueda textual
  useEffect(() => {
    const t = setTimeout(() => {
      setFiltros((prev) => ({ ...prev, busqueda: busquedaInput }));
      setPagina(1);
    }, 250);
    return () => clearTimeout(t);
  }, [busquedaInput]);

  // Recibir filtro inicial desde el Dashboard (preservando el local activo)
  useEffect(() => {
    if (!initialFilter) return;
    if (typeof initialFilter === 'object') {
      if (initialFilter.vista === 'reportes') {
        setVistaActiva('reportes');
        if (initialFilter.reporteId) setReporteInicial(initialFilter.reporteId);
      } else {
        setVistaActiva('tabla');
      }
      if (initialFilter.filtros) {
        const nextLocal = initialFilter.filtros.localId ?? selectedLocalId ?? 'ALL';
        if (initialFilter.filtros.localId !== undefined && onChangeLocalId) {
          onChangeLocalId(initialFilter.filtros.localId);
        }
        setFiltros({ ...FILTROS_INICIALES, ...initialFilter.filtros, localId: nextLocal });
      }
    } else if (typeof initialFilter === 'string') {
      setVistaActiva('tabla');
      if (['OK', 'OBSERVADO', 'ERROR', 'ALL'].includes(initialFilter)) {
        setFiltros({ ...FILTROS_INICIALES, estado: initialFilter, localId: selectedLocalId || 'ALL' });
      } else if (initialFilter.startsWith('ERROR ') || initialFilter.startsWith('OBS ')) {
        setFiltros({ ...FILTROS_INICIALES, codigos: [initialFilter], localId: selectedLocalId || 'ALL' });
      }
    }
    setPagina(1);
    if (onFilterReset) onFilterReset();
  }, [initialFilter, onFilterReset, selectedLocalId, onChangeLocalId]);

  const localActivoId = selectedLocalId || 'ALL';

  // Solo reiniciar si ya cargaron los locales de la empresa y el local elegido ya no existe
  useEffect(() => {
    if (
      localesFetched &&
      !localesLoading &&
      localActivoId !== 'ALL' &&
      localActivoId !== 'SIN_LOCAL' &&
      !localesActivos.some((l) => l.id === localActivoId)
    ) {
      if (onChangeLocalId) onChangeLocalId('ALL');
    }
  }, [localesFetched, localesLoading, localActivoId, localesActivos, onChangeLocalId]);

  const filtrosEfectivos = useMemo(
    () => ({ ...filtros, localId: localActivoId }),
    [filtros, localActivoId]
  );

  const docsFiltrados = useMemo(
    () => filtrarDocumentos(todosDocs, filtrosEfectivos, indiceLocales),
    [todosDocs, filtrosEfectivos, indiceLocales]
  );

  const conteoPorCodigoBase = useMemo(() => {
    const sinCodigos = filtrarDocumentos(todosDocs, { ...filtrosEfectivos, codigos: [] }, indiceLocales);
    return calcularIndicadores(sinCodigos).porCodigo;
  }, [todosDocs, filtrosEfectivos, indiceLocales]);

  // Correlativos faltantes (OBS 3) cuando el usuario filtra por OBS 3 en la tabla principal
  const mostrandoObs3 = vistaActiva === 'tabla' && filtros.codigos.includes('OBS 3');
  const soloObs3 = vistaActiva === 'tabla' && filtros.codigos.length === 1 && filtros.codigos[0] === 'OBS 3';
  const saltosObs3Filtrados = useMemo(() => {
    if (!mostrandoObs3 || todosDocs.length === 0) return [];
    const { saltos } = calcularSecuencias(todosDocs);
    const serieQ = (filtros.serie || '').trim().toUpperCase();
    const q = (filtros.busqueda || '').trim().toLowerCase();
    return saltos.filter((s) => {
      if (localActivoId !== 'ALL' && !coincideConLocal(s, localActivoId, indiceLocales)) return false;
      if (filtros.tipoCP !== 'ALL' && s.tipo_doc_pago !== filtros.tipoCP) return false;
      if (serieQ && !s.serie.toUpperCase().includes(serieQ)) return false;
      if (filtros.fechaDesde && s.fecha_siguiente && s.fecha_siguiente < filtros.fechaDesde) return false;
      if (filtros.fechaHasta && s.fecha_siguiente && s.fecha_siguiente > filtros.fechaHasta) return false;
      if (q) {
        const texto = [
          s.serie,
          s.anterior,
          s.siguiente,
          `${s.serie}-${s.anterior}`,
          `${s.serie}-${s.siguiente}`,
          s.rango_faltante,
          s.sistema_etiqueta,
          ...s.correlativos_faltantes.slice(0, 30).map((c) => `${s.serie}-${c}`),
        ]
          .join(' ')
          .toLowerCase();
        if (!texto.includes(q)) return false;
      }
      return true;
    });
  }, [mostrandoObs3, todosDocs, localActivoId, indiceLocales, filtros.tipoCP, filtros.serie, filtros.fechaDesde, filtros.fechaHasta, filtros.busqueda]);

  // Paginación en memoria
  const totalRegistros = docsFiltrados.length;
  const totalPaginas = Math.ceil(totalRegistros / porPagina);
  const filasPagina = useMemo(
    () => docsFiltrados.slice((pagina - 1) * porPagina, pagina * porPagina),
    [docsFiltrados, pagina, porPagina]
  );

  // Virtualización de listas largas (> 40 filas en página)
  const {
    containerRef,
    onScroll,
    visibleItems: filasVirtualizadas,
    isVirtualized,
    topPaddingHeight,
    bottomPaddingHeight,
    maxHeight,
  } = useVirtualList(filasPagina, { rowHeight: 36, viewportHeight: 560, overscan: 10, threshold: 40 });

  const actualizarFiltro = useCallback((parcial) => {
    setFiltros((prev) => ({ ...prev, ...parcial }));
    setPagina(1);
  }, []);

  const filtrarPorEstado = useCallback(
    (est) => {
      actualizarFiltro({ estado: est });
    },
    [actualizarFiltro]
  );

  const toggleCodigoIncidencia = useCallback((codigo) => {
    setVistaActiva('tabla');
    setFiltros((prev) => {
      const existe = prev.codigos.includes(codigo);
      const nuevos = existe ? prev.codigos.filter((c) => c !== codigo) : [...prev.codigos, codigo];
      return { ...prev, codigos: nuevos };
    });
    setPagina(1);
  }, []);

  const seleccionarSoloCodigo = useCallback((codigo) => {
    setVistaActiva('tabla');
    setFiltros((prev) => ({ ...prev, estado: 'ALL', codigos: [codigo] }));
    setPagina(1);
  }, []);

  const limpiarTodosLosFiltros = useCallback(() => {
    setBusquedaInput('');
    setFiltros(FILTROS_INICIALES);
    if (onChangeLocalId) onChangeLocalId('ALL');
    setPagina(1);
  }, [onChangeLocalId]);

  const cerrarModal = useCallback(() => {
    setDocSeleccionado(null);
  }, []);

  const hayFiltrosActivos =
    filtros.busqueda !== '' ||
    filtros.estado !== 'ALL' ||
    filtros.tipoCP !== 'ALL' ||
    filtros.existencia !== 'ALL' ||
    filtros.categoria !== 'ALL' ||
    localActivoId !== 'ALL' ||
    filtros.codigos.length > 0 ||
    filtros.serie !== '' ||
    filtros.corrDesde !== '' ||
    filtros.corrHasta !== '' ||
    filtros.fechaDesde !== '' ||
    filtros.fechaHasta !== '';

  const getPageNumbers = () => {
    const pages = [];
    const maxVisible = 5;
    if (totalPaginas <= maxVisible) {
      for (let i = 1; i <= totalPaginas; i++) pages.push(i);
    } else {
      pages.push(1);
      let start = Math.max(2, pagina - 1);
      let end = Math.min(totalPaginas - 1, pagina + 1);
      if (pagina <= 3) end = 4;
      else if (pagina >= totalPaginas - 2) start = totalPaginas - 3;
      if (start > 2) pages.push('...');
      for (let i = start; i <= end; i++) pages.push(i);
      if (end < totalPaginas - 1) pages.push('...');
      pages.push(totalPaginas);
    }
    return pages;
  };

  const opcionesExportacion = [
    { id: 'vista_actual', label: 'Detalle comparativo SAP vs. SUNAT (vista filtrada)' },
    { id: 'resumen', label: 'Resumen general de documentos e importes' },
    { id: 'correctos', label: 'Documentos correctos (OK)' },
    { id: 'observaciones', label: 'Documentos observados' },
    { id: 'errores', label: 'Documentos con errores' },
    { id: 'por_incidencia', label: 'Reportes por grupo de incidencia (1 hoja por código)' },
    { id: 'completo', label: 'Libro completo de conciliación (todas las hojas)' },
  ];

  return (
    <div className="animate-fade-in">
      {/* SECCIÓN 9: Panel de Filtros por Grupo de Errores y Observaciones (Diseño UI/UX Pro Max) */}
      <div className="incidence-filter-panel mb-3">
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
          <div className="d-flex align-items-center gap-2">
            <FiFilter className="text-primary" />
            <span className="fw-bold" style={{ fontSize: '0.88rem', color: 'var(--color-text)' }}>
              Filtro Rápido por Código de Incidencia
            </span>
            <span className="text-muted" style={{ fontSize: '0.76rem' }}>
              (selección individual o múltiple)
            </span>
          </div>
          <div className="d-flex align-items-center gap-3">
            <div className="form-check form-switch mb-0 d-flex align-items-center gap-1.5">
              <input
                id="switch-ocultar-ceros"
                type="checkbox"
                className="form-check-input m-0"
                style={{ cursor: 'pointer' }}
                checked={ocultarSinIncidencias}
                onChange={(e) => setOcultarSinIncidencias(e.target.checked)}
              />
              <label
                htmlFor="switch-ocultar-ceros"
                className="form-check-label text-muted fw-semibold"
                style={{ fontSize: '0.76rem', cursor: 'pointer', userSelect: 'none' }}
              >
                Solo con hallazgos (&gt; 0)
              </label>
            </div>
            {filtros.codigos.length > 0 && (
              <button
                type="button"
                className="btn btn-sm btn-link p-0 text-decoration-none fw-semibold"
                style={{ fontSize: '0.78rem' }}
                onClick={() => actualizarFiltro({ codigos: [] })}
              >
                Limpiar selección ({filtros.codigos.length})
              </button>
            )}
          </div>
        </div>

        <div className="row g-2">
          {/* Columna Errores */}
          <div className="col-lg-6">
            <div className="incidence-section-box">
              <div className="incidence-section-header">
                <span className="fw-bold text-danger" style={{ fontSize: '0.72rem', letterSpacing: '0.04em' }}>
                  GRUPOS DE ERROR (INCUMPLIMIENTOS PRINCIPALES)
                </span>
                <span className="font-mono text-muted" style={{ fontSize: '0.7rem' }}>
                  {INCIDENCIAS.filter((i) => i.tipo === 'ERROR').reduce((acc, i) => acc + (conteoPorCodigoBase[i.codigo] || 0), 0).toLocaleString('es-PE')} hallazgos
                </span>
              </div>
              <div className="incidence-grid">
                {INCIDENCIAS.filter((i) => i.tipo === 'ERROR')
                  .filter((inc) => !ocultarSinIncidencias || (conteoPorCodigoBase[inc.codigo] || 0) > 0 || filtros.codigos.includes(inc.codigo))
                  .map((inc) => {
                    const count = conteoPorCodigoBase[inc.codigo] || 0;
                    const activo = filtros.codigos.includes(inc.codigo);
                    const hasItems = count > 0;
                    const chipClass = [
                      'incidence-chip',
                      activo ? 'is-active-error' : hasItems ? 'has-items-error' : 'is-empty',
                    ].join(' ');
                    return (
                      <button
                        key={inc.codigo}
                        type="button"
                        onClick={() => toggleCodigoIncidencia(inc.codigo)}
                        className={chipClass}
                        aria-pressed={activo}
                        title={`${inc.codigo}: ${inc.descripcion} (${count.toLocaleString('es-PE')} documentos)`}
                      >
                        <span className={`incidence-code-badge ${hasItems || activo ? 'tone-error' : 'tone-muted'}`}>
                          {inc.codigo}
                        </span>
                        <span className="incidence-label">{inc.corto}</span>
                        <span className={`incidence-count ${hasItems || activo ? 'count-error' : 'count-zero'}`}>
                          {count.toLocaleString('es-PE')}
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>
          </div>

          {/* Columna Observaciones */}
          <div className="col-lg-6">
            <div className="incidence-section-box">
              <div className="incidence-section-header">
                <span className="fw-bold text-warning" style={{ fontSize: '0.72rem', letterSpacing: '0.04em' }}>
                  GRUPOS DE OBSERVACIÓN (DIFERENCIAS PARA REVISIÓN)
                </span>
                <span className="font-mono text-muted" style={{ fontSize: '0.7rem' }}>
                  {INCIDENCIAS.filter((i) => i.tipo === 'OBS').reduce((acc, i) => acc + (conteoPorCodigoBase[i.codigo] || 0), 0).toLocaleString('es-PE')} hallazgos
                </span>
              </div>
              <div className="incidence-grid">
                {INCIDENCIAS.filter((i) => i.tipo === 'OBS')
                  .filter((inc) => !ocultarSinIncidencias || (conteoPorCodigoBase[inc.codigo] || 0) > 0 || filtros.codigos.includes(inc.codigo))
                  .map((inc) => {
                    const count = conteoPorCodigoBase[inc.codigo] || 0;
                    const activo = filtros.codigos.includes(inc.codigo);
                    const hasItems = count > 0;
                    const chipClass = [
                      'incidence-chip',
                      activo ? 'is-active-obs' : hasItems ? 'has-items-obs' : 'is-empty',
                    ].join(' ');
                    return (
                      <button
                        key={inc.codigo}
                        type="button"
                        onClick={() => toggleCodigoIncidencia(inc.codigo)}
                        className={chipClass}
                        aria-pressed={activo}
                        title={`${inc.codigo}: ${inc.descripcion} (${count.toLocaleString('es-PE')} documentos)`}
                      >
                        <span className={`incidence-code-badge ${hasItems || activo ? 'tone-obs' : 'tone-muted'}`}>
                          {inc.codigo}
                        </span>
                        <span className="incidence-label">{inc.corto}</span>
                        <span className={`incidence-count ${hasItems || activo ? 'count-obs' : 'count-zero'}`}>
                          {count.toLocaleString('es-PE')}
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CONTENEDOR PRINCIPAL */}
      <div className="card-premium mb-4">
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <div className="btn-group" role="group">
              <button
                type="button"
                className={`btn btn-sm fw-bold d-inline-flex align-items-center px-3 py-2 ${vistaActiva === 'tabla' ? 'btn-primary' : 'btn-outline-secondary'}`}
                style={{ gap: '0.45rem' }}
                onClick={() => setVistaActiva('tabla')}
              >
                <FiList />
                <span>Tabla Principal de Documentos ({docsFiltrados.length.toLocaleString('es-PE')})</span>
              </button>
              <button
                type="button"
                className={`btn btn-sm fw-bold d-inline-flex align-items-center px-3 py-2 ${vistaActiva === 'reportes' ? 'btn-primary' : 'btn-outline-secondary'}`}
                style={{ gap: '0.45rem' }}
                onClick={() => setVistaActiva('reportes')}
              >
                <FiBarChart2 />
                <span>Reportes Específicos (12)</span>
              </button>
            </div>

            {vistaActiva === 'tabla' && (
              <select
                className="form-select form-control-premium"
                style={{ width: 'auto', minWidth: '108px', fontSize: '0.84rem' }}
                value={porPagina}
                onChange={(e) => { setPorPagina(parseInt(e.target.value, 10)); setPagina(1); }}
              >
                <option value={15}>15 filas</option>
                <option value={20}>20 filas</option>
                <option value={50}>50 filas</option>
                <option value={100}>100 filas</option>
                <option value={250}>250 filas</option>
                <option value={500}>500 filas</option>
              </select>
            )}

            <SelectorLocal
              locales={localesActivos}
              value={localActivoId}
              onChange={(val) => {
                if (onChangeLocalId) onChangeLocalId(val);
                actualizarFiltro({ localId: val });
              }}
              mostrarSinAsignar
              align="left"
            />
          </div>

          {/* Menú de exportación de resultados */}
          <div className="position-relative">
            <button
              type="button"
              disabled={todosDocs.length === 0}
              className="btn btn-outline-primary btn-sm d-flex align-items-center px-3 py-1.5 rounded-3 fw-semibold"
              onClick={() => setMostrarMenuExportar((v) => !v)}
            >
              <FiDownload className="me-1.5" /> Exportar Resultados <FiChevronDown className="ms-1" />
            </button>
            {mostrarMenuExportar && (
              <ul
                className="dropdown-premium-menu show"
                style={{ right: 0, left: 'auto', minWidth: '320px', maxWidth: '360px' }}
                onMouseLeave={() => setMostrarMenuExportar(false)}
              >
                {opcionesExportacion.map((op) => (
                  <li key={op.id}>
                    <button
                      type="button"
                      className="dropdown-premium-item"
                      style={{ whiteSpace: 'normal', fontSize: '0.8rem' }}
                      onClick={() => {
                        setMostrarMenuExportar(false);
                        exportarExcelVentas({
                          tipo: op.id,
                          docs: docsFiltrados,
                          todosDocs,
                          periodo: activePeriod,
                        });
                      }}
                    >
                      {op.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Barra de filtros generales */}
        <div className="row g-2 mb-3">
          <div className="col-lg-3">
            <div className="input-group">
              <span className="input-group-text border" style={{ backgroundColor: '#F8FAFC', borderColor: 'var(--border-color)', color: '#64748B' }}>
                <FiSearch />
              </span>
              <input
                type="text"
                className="form-control form-control-premium"
                placeholder="Buscar serie-correlativo, RUC/DNI, nombre..."
                value={busquedaInput}
                onChange={(e) => setBusquedaInput(e.target.value)}
              />
            </div>
          </div>

          <div className="col-lg-2">
            <select
              className="form-select form-control-premium"
              value={filtros.estado}
              onChange={(e) => actualizarFiltro({ estado: e.target.value })}
            >
              <option value="ALL">Estado: Todos</option>
              <option value="OK">Correcto (Verde)</option>
              <option value="OBSERVADO">Observación (Ámbar)</option>
              <option value="ERROR">Error (Rojo)</option>
            </select>
          </div>

          <div className="col-lg-2">
            <select
              className="form-select form-control-premium"
              value={filtros.tipoCP}
              onChange={(e) => actualizarFiltro({ tipoCP: e.target.value })}
            >
              <option value="ALL">Comprobante: Todos</option>
              <option value="01">01 · Factura</option>
              <option value="03">03 · Boleta de Venta</option>
              <option value="07">07 · Nota de Crédito</option>
              <option value="08">08 · Nota de Débito</option>
            </select>
          </div>

          <div className="col-lg-2">
            <select
              className="form-select form-control-premium"
              value={filtros.existencia}
              onChange={(e) => actualizarFiltro({ existencia: e.target.value })}
            >
              <option value="ALL">Origen: Todos</option>
              <option value="AMBOS">Coincidentes (SAP y SUNAT)</option>
              <option value="SAP">Registrados en SAP</option>
              <option value="SUNAT">Registrados en SUNAT</option>
              <option value="SOLO_SAP">Únicamente en SAP (OBS 5)</option>
              <option value="SOLO_SUNAT">Únicamente en SUNAT (OBS 4)</option>
            </select>
          </div>

          <div className="col-lg-3">
            <select
              className="form-select form-control-premium"
              value={filtros.categoria}
              onChange={(e) => actualizarFiltro({ categoria: e.target.value })}
            >
              <option value="ALL">Categoría: Todas</option>
              <option value="DIF_IMPORTES">Con diferencias de importes (&gt; S/ 0.05)</option>
              <option value="PROB_IDENTIDAD">Con problemas de identificación</option>
              <option value="CORTESIAS">Cortesías identificadas</option>
            </select>
          </div>
        </div>

        {/* Segunda fila: serie, rango de correlativos y fechas */}
        <div className="row g-2 mb-3">
          <div className="col-lg-2">
            <div className="input-group">
              <span className="input-group-text border" style={{ backgroundColor: '#F8FAFC', borderColor: 'var(--border-color)', color: '#64748B', fontSize: '0.8rem' }}>Serie</span>
              <input
                type="text"
                className="form-control form-control-premium font-mono"
                placeholder="Ej. B805"
                value={filtros.serie}
                onChange={(e) => actualizarFiltro({ serie: e.target.value })}
              />
            </div>
          </div>
          <div className="col-lg-2">
            <div className="input-group">
              <span className="input-group-text border" style={{ backgroundColor: '#F8FAFC', borderColor: 'var(--border-color)', color: '#64748B', fontSize: '0.8rem' }}>Corr. ≥</span>
              <input
                type="text"
                className="form-control form-control-premium font-mono"
                placeholder="Desde"
                value={filtros.corrDesde}
                onChange={(e) => actualizarFiltro({ corrDesde: e.target.value })}
              />
            </div>
          </div>
          <div className="col-lg-2">
            <div className="input-group">
              <span className="input-group-text border" style={{ backgroundColor: '#F8FAFC', borderColor: 'var(--border-color)', color: '#64748B', fontSize: '0.8rem' }}>Corr. ≤</span>
              <input
                type="text"
                className="form-control form-control-premium font-mono"
                placeholder="Hasta"
                value={filtros.corrHasta}
                onChange={(e) => actualizarFiltro({ corrHasta: e.target.value })}
              />
            </div>
          </div>
          <div className="col-lg-2">
            <div className="input-group">
              <span className="input-group-text border" style={{ backgroundColor: '#F8FAFC', borderColor: 'var(--border-color)', color: '#64748B', fontSize: '0.8rem' }}>Desde</span>
              <input
                type="date"
                className="form-control form-control-premium"
                value={filtros.fechaDesde}
                onChange={(e) => actualizarFiltro({ fechaDesde: e.target.value })}
              />
            </div>
          </div>
          <div className="col-lg-2">
            <div className="input-group">
              <span className="input-group-text border" style={{ backgroundColor: '#F8FAFC', borderColor: 'var(--border-color)', color: '#64748B', fontSize: '0.8rem' }}>Hasta</span>
              <input
                type="date"
                className="form-control form-control-premium"
                value={filtros.fechaHasta}
                onChange={(e) => actualizarFiltro({ fechaHasta: e.target.value })}
              />
            </div>
          </div>
          <div className="col-lg-2">
            <button
              type="button"
              disabled={!hayFiltrosActivos}
              className="btn btn-outline-secondary w-100 h-100 d-flex align-items-center justify-content-center py-1.5 rounded-3 fw-semibold"
              style={{ fontSize: '0.82rem' }}
              onClick={limpiarTodosLosFiltros}
            >
              <FiRefreshCw className="me-1" /> Limpiar Filtros
            </button>
          </div>
        </div>

        {/* Contenido principal: Skeleton de carga, Tabla de 20 columnas o los 12 Reportes Específicos */}
        {isLoading ? (
          <SkeletonTable rows={10} columns={10} title="Cargando comprobantes conciliados..." />
        ) : vistaActiva === 'reportes' ? (
          <ReportesEspecificosVentas
            docs={docsFiltrados}
            todosDocs={todosDocs}
            activePeriod={activePeriod}
            reporteInicial={reporteInicial}
            onSelectDoc={setDocSeleccionado}
            onFiltrarCodigo={seleccionarSoloCodigo}
          />
        ) : soloObs3 ? (
          saltosObs3Filtrados.length > 0 ? (
            <PanelSaltosSecuenciaVentas
              saltos={saltosObs3Filtrados}
              onSelectDoc={setDocSeleccionado}
              onExportarSecuencia={() =>
                exportarExcelVentas({
                  tipo: 'secuencia',
                  docs: docsFiltrados,
                  todosDocs,
                  periodo: activePeriod,
                })
              }
            />
          ) : (
            <div
              className="text-center py-5 rounded-3"
              style={{ backgroundColor: 'rgba(241, 245, 249, 0.6)', border: '1px dashed var(--border-color)' }}
            >
              <FiAlertCircle className="text-muted fs-1 mb-2" />
              <p className="text-muted mb-0 fw-semibold">
                No se encontraron saltos de correlativos para los filtros seleccionados.
              </p>
            </div>
          )
        ) : (
          <>
            {/* Panel dedicado de Correlativos Faltantes cuando se combina OBS 3 con otros códigos */}
            {mostrandoObs3 && saltosObs3Filtrados.length > 0 && (
              <PanelSaltosSecuenciaVentas
                saltos={saltosObs3Filtrados}
                onSelectDoc={setDocSeleccionado}
                onExportarSecuencia={() =>
                  exportarExcelVentas({
                    tipo: 'secuencia',
                    docs: docsFiltrados,
                    todosDocs,
                    periodo: activePeriod,
                  })
                }
              />
            )}

            {totalRegistros === 0 ? (
              <div
                className="text-center py-5 rounded-3"
                style={{ backgroundColor: 'rgba(241, 245, 249, 0.6)', border: '1px dashed var(--border-color)' }}
              >
                <FiAlertCircle className="text-muted fs-1 mb-2" />
                <p className="text-muted mb-0 fw-semibold">
                  {todosDocs.length === 0
                    ? 'No hay documentos cargados en este período. Utilice el panel superior para cargar los archivos SAP y SUNAT.'
                    : 'No se encontraron comprobantes para los filtros seleccionados.'}
                </p>
              </div>
            ) : (
              <>
                {/* SECCIÓN 10: Tabla Principal con las 20 columnas requeridas + Virtualización */}
            <div
              ref={containerRef}
              onScroll={onScroll}
              className="table-responsive"
              style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}
            >
              <table className="table table-hover table-dense align-middle text-nowrap mb-0">
                <thead>
                  <tr>
                    <th>1. N° Documento</th>
                    <th>2. Fecha Emisión</th>
                    <th>3. Tipo CP</th>
                    <th>4. Tipo ID SAP</th>
                    <th>5. N° ID SAP</th>
                    <th>6. Nombre SAP</th>
                    <th>7. Tipo ID SUNAT</th>
                    <th>8. N° ID SUNAT</th>
                    <th>9. Nombre SUNAT</th>
                    <th className="text-end col-group-bi col-pair-start">10. BI SAP</th>
                    <th className="text-end col-group-bi col-pair-end">11. BI SUNAT</th>
                    <th className="text-end col-group-igv col-pair-start">12. IGV SAP</th>
                    <th className="text-end col-group-igv col-pair-end">13. IGV SUNAT</th>
                    <th className="text-end col-group-otros col-pair-start">14. Otros SAP</th>
                    <th className="text-end col-group-otros col-pair-end">15. Otros SUNAT</th>
                    <th className="text-end col-group-total col-pair-start">16. Total SAP</th>
                    <th className="text-end col-group-total col-pair-end">17. Total SUNAT</th>
                    <th className="text-end">18. Diferencia</th>
                    <th className="text-center">19. Estado</th>
                    <th>20. Incidencias</th>
                  </tr>
                </thead>
                <tbody>
                  {isVirtualized && topPaddingHeight > 0 && (
                    <tr aria-hidden="true">
                      <td colSpan={20} style={{ height: `${topPaddingHeight}px`, padding: 0, border: 0 }} />
                    </tr>
                  )}
                  {filasVirtualizadas.map((d) => (
                    <FilaDocumentoVenta
                      key={d.key}
                      d={d}
                      onSelectDoc={setDocSeleccionado}
                      onFilterEstado={filtrarPorEstado}
                      onFilterCodigo={seleccionarSoloCodigo}
                    />
                  ))}
                  {isVirtualized && bottomPaddingHeight > 0 && (
                    <tr aria-hidden="true">
                      <td colSpan={20} style={{ height: `${bottomPaddingHeight}px`, padding: 0, border: 0 }} />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Paginación */}
            {totalPaginas > 1 && (
              <div className="d-flex justify-content-between align-items-center mt-3 pt-3 flex-wrap gap-2" style={{ borderTop: '1px solid var(--border-color)' }}>
                <span className="text-muted" style={{ fontSize: '0.85rem' }}>
                  Mostrando {(pagina - 1) * porPagina + 1} - {Math.min(pagina * porPagina, totalRegistros)} de {totalRegistros.toLocaleString('es-PE')} comprobantes.
                </span>
                <nav>
                  <ul className="pagination pagination-premium mb-0">
                    <li className={`page-item ${pagina === 1 ? 'disabled' : ''}`}>
                      <button className="page-link" onClick={() => setPagina(pagina - 1)}>
                        Anterior
                      </button>
                    </li>
                    {getPageNumbers().map((num, i) =>
                      num === '...' ? (
                        <li key={`el-${i}`} className="page-item-ellipsis d-flex align-items-center justify-content-center">
                          ...
                        </li>
                      ) : (
                        <li key={`p-${num}`} className={`page-item ${pagina === num ? 'active' : ''}`}>
                          <button className="page-link" onClick={() => setPagina(num)}>
                            {num}
                          </button>
                        </li>
                      )
                    )}
                    <li className={`page-item ${pagina === totalPaginas ? 'disabled' : ''}`}>
                      <button className="page-link" onClick={() => setPagina(pagina + 1)}>
                        Siguiente
                      </button>
                    </li>
                  </ul>
                </nav>
                </div>
              )}
              </>
            )}
          </>
        )}
      </div>

      {/* Modal de detalle comparativo SAP vs SUNAT */}
      <ModalDetalleDocumentoVentas
        doc={docSeleccionado}
        localNombre={
          docSeleccionado
            ? indiceLocales.obtenerLocal(docSeleccionado.serie, docSeleccionado.tipo_doc_pago)?.nombre || null
            : null
        }
        onClose={cerrarModal}
        onFiltrarCodigo={seleccionarSoloCodigo}
        onSelectDoc={setDocSeleccionado}
      />
    </div>
  );
});

export default ConciliacionVentas;
