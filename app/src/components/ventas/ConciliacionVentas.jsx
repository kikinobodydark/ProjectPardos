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
import ModalDetalleDocumentoVentas from './ModalDetalleDocumentoVentas';
import ReportesEspecificosVentas from './ReportesEspecificosVentas';
import { SkeletonTable } from '../SkeletonLoader';
import { useVirtualList } from '../../utils/useVirtualList';
import { useNetworkProfile } from '../../utils/networkProfile';
import {
  INCIDENCIAS, ESTADOS, descripcionTipoCP,
} from '../../utils/ventas/catalogos';
import {
  FILTROS_INICIALES, filtrarDocumentos, calcularIndicadores, exportarExcelVentas,
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

      {/* Importes (10 - 18) */}
      <td className="text-end font-mono">{d.en_sap ? formatoMonto(d.sap.base) : '—'}</td>
      <td className={`text-end font-mono ${diffBase ? 'cell-mismatch' : 'cell-match'}`}>
        {d.en_sunat ? formatoMonto(d.sunat.base) : '—'}
      </td>

      <td className="text-end font-mono">{d.en_sap ? formatoMonto(d.sap.igv) : '—'}</td>
      <td className={`text-end font-mono ${diffIgv ? 'cell-mismatch' : 'cell-match'}`}>
        {d.en_sunat ? formatoMonto(d.sunat.igv) : '—'}
      </td>

      <td className="text-end font-mono">{d.en_sap ? formatoMonto(d.sap.otros) : '—'}</td>
      <td className={`text-end font-mono ${diffOtros ? 'cell-mismatch' : 'cell-match'}`}>
        {d.en_sunat ? formatoMonto(d.sunat.otros) : '—'}
      </td>

      <td className="text-end font-mono fw-semibold">{d.en_sap ? formatoMonto(d.sap.total) : '—'}</td>
      <td className={`text-end font-mono fw-semibold ${diffTotal ? 'cell-mismatch' : 'cell-match'}`}>
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
  periodId, activePeriod, initialFilter, onFilterReset,
}) {
  const { data: todosDocs = [], isLoading } = useDocumentosVentas(periodId, true);
  const networkProfile = useNetworkProfile();

  const [filtros, setFiltros] = useState(FILTROS_INICIALES);
  const [busquedaInput, setBusquedaInput] = useState('');
  const [vistaActiva, setVistaActiva] = useState('tabla');
  const [reporteInicial, setReporteInicial] = useState('resumen');
  const [mostrarMenuExportar, setMostrarMenuExportar] = useState(false);
  const [docSeleccionado, setDocSeleccionado] = useState(null);

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

  // Recibir filtro inicial desde el Dashboard
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
        setFiltros({ ...FILTROS_INICIALES, ...initialFilter.filtros });
      }
    } else if (typeof initialFilter === 'string') {
      setVistaActiva('tabla');
      if (['OK', 'OBSERVADO', 'ERROR', 'ALL'].includes(initialFilter)) {
        setFiltros({ ...FILTROS_INICIALES, estado: initialFilter });
      } else if (initialFilter.startsWith('ERROR ') || initialFilter.startsWith('OBS ')) {
        setFiltros({ ...FILTROS_INICIALES, codigos: [initialFilter] });
      }
    }
    setPagina(1);
    if (onFilterReset) onFilterReset();
  }, [initialFilter, onFilterReset]);

  const docsFiltrados = useMemo(
    () => filtrarDocumentos(todosDocs, filtros),
    [todosDocs, filtros]
  );

  const conteoPorCodigoBase = useMemo(() => {
    const sinCodigos = filtrarDocumentos(todosDocs, { ...filtros, codigos: [] });
    return calcularIndicadores(sinCodigos).porCodigo;
  }, [todosDocs, filtros]);

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
    setPagina(1);
  }, []);

  const cerrarModal = useCallback(() => {
    setDocSeleccionado(null);
  }, []);

  const hayFiltrosActivos =
    filtros.busqueda !== '' ||
    filtros.estado !== 'ALL' ||
    filtros.tipoCP !== 'ALL' ||
    filtros.existencia !== 'ALL' ||
    filtros.categoria !== 'ALL' ||
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
      {/* SECCIÓN 9: Panel de Filtros por Grupo de Errores y Observaciones (multi-selección) */}
      <div className="card-premium mb-3 p-3">
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
          <div className="d-flex align-items-center gap-2">
            <FiFilter className="text-primary" />
            <span className="fw-bold" style={{ fontSize: '0.88rem' }}>
              Filtro por Grupo de Errores y Observaciones (selección individual o múltiple)
            </span>
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

        <div className="row g-2">
          <div className="col-lg-6">
            <div className="small fw-bold text-danger mb-1" style={{ fontSize: '0.73rem', letterSpacing: '0.04em' }}>
              GRUPOS DE ERROR (INCUMPLIMIENTOS PRINCIPALES)
            </div>
            <div className="d-flex flex-wrap gap-1.5" style={{ gap: '6px' }}>
              {INCIDENCIAS.filter((i) => i.tipo === 'ERROR').map((inc) => {
                const count = conteoPorCodigoBase[inc.codigo] || 0;
                const activo = filtros.codigos.includes(inc.codigo);
                return (
                  <button
                    key={inc.codigo}
                    type="button"
                    onClick={() => toggleCodigoIncidencia(inc.codigo)}
                    className="btn btn-sm d-inline-flex align-items-center rounded-2"
                    style={{
                      fontSize: '0.75rem',
                      padding: '0.3rem 0.6rem',
                      gap: '0.38rem',
                      backgroundColor: activo ? '#DC2626' : 'rgba(220, 38, 38, 0.06)',
                      color: activo ? '#FFFFFF' : '#B91C1C',
                      border: `1px solid ${activo ? '#DC2626' : 'rgba(220, 38, 38, 0.22)'}`,
                      opacity: count === 0 && !activo ? 0.6 : 1,
                    }}
                    title={`${inc.codigo}: ${inc.descripcion} (${count} documentos)`}
                  >
                    <strong className="font-mono">{inc.codigo}</strong>
                    <span>{inc.corto}</span>
                    <span
                      className="badge rounded-pill font-mono ms-1"
                      style={{
                        backgroundColor: activo ? 'rgba(255,255,255,0.22)' : 'rgba(220, 38, 38, 0.14)',
                        color: activo ? '#FFFFFF' : '#991B1B',
                      }}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="col-lg-6">
            <div className="small fw-bold text-warning mb-1" style={{ fontSize: '0.73rem', letterSpacing: '0.04em' }}>
              GRUPOS DE OBSERVACIÓN (DIFERENCIAS PARA REVISIÓN)
            </div>
            <div className="d-flex flex-wrap gap-1.5" style={{ gap: '6px' }}>
              {INCIDENCIAS.filter((i) => i.tipo === 'OBS').map((inc) => {
                const count = conteoPorCodigoBase[inc.codigo] || 0;
                const activo = filtros.codigos.includes(inc.codigo);
                return (
                  <button
                    key={inc.codigo}
                    type="button"
                    onClick={() => toggleCodigoIncidencia(inc.codigo)}
                    className="btn btn-sm d-inline-flex align-items-center rounded-2"
                    style={{
                      fontSize: '0.75rem',
                      padding: '0.3rem 0.6rem',
                      gap: '0.38rem',
                      backgroundColor: activo ? '#D97706' : 'rgba(217, 119, 6, 0.07)',
                      color: activo ? '#FFFFFF' : '#B45309',
                      border: `1px solid ${activo ? '#D97706' : 'rgba(217, 119, 6, 0.25)'}`,
                      opacity: count === 0 && !activo ? 0.6 : 1,
                    }}
                    title={`${inc.codigo}: ${inc.descripcion} (${count} documentos)`}
                  >
                    <strong className="font-mono">{inc.codigo}</strong>
                    <span>{inc.corto}</span>
                    <span
                      className="badge rounded-pill font-mono ms-1"
                      style={{
                        backgroundColor: activo ? 'rgba(255,255,255,0.22)' : 'rgba(217, 119, 6, 0.16)',
                        color: activo ? '#FFFFFF' : '#92400E',
                      }}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
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
        ) : totalRegistros === 0 ? (
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
                    <th className="text-end">10. BI SAP</th>
                    <th className="text-end">11. BI SUNAT</th>
                    <th className="text-end">12. IGV SAP</th>
                    <th className="text-end">13. IGV SUNAT</th>
                    <th className="text-end">14. Otros SAP</th>
                    <th className="text-end">15. Otros SUNAT</th>
                    <th className="text-end">16. Total SAP</th>
                    <th className="text-end">17. Total SUNAT</th>
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
      </div>

      {/* Modal de detalle comparativo SAP vs SUNAT */}
      <ModalDetalleDocumentoVentas
        doc={docSeleccionado}
        onClose={cerrarModal}
        onFiltrarCodigo={seleccionarSoloCodigo}
      />
    </div>
  );
});

export default ConciliacionVentas;
