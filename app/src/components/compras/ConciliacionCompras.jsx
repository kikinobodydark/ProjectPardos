// ============================================================================
// Vista principal de Conciliación del módulo de Compras (SAP vs. SUNAT — RCE).
//  - Panel de 7 indicadores clicables (Sección 7.A)
//  - Panel rápido de filtros por los 8 Errores y 3 Observaciones
//  - Filtros completos: estado, tipo error, tipo obs, RUC, razón social,
//    tipo de documento, serie y fechas de emisión (Sección 7.C)
//  - Tabla de 20 columnas con virtualización y resaltado de diferencias (7.B)
//  - Modal comparativo de detalle del documento (7.D)
//  - Exportación a Excel respetando filtros o totalidad de resultados (Sec. 8)
// ============================================================================
import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  FiDownload,
  FiSearch,
  FiEye,
  FiFilter,
  FiChevronDown,
  FiAlertCircle,
  FiRefreshCw,
  FiCopy,
  FiCheck,
  FiUpload,
  FiUser,
  FiX,
} from 'react-icons/fi';
import { useDocumentosCompras } from './useDocumentosCompras';
import ModalDetalleDocumentoCompras from './ModalDetalleDocumentoCompras';
import { SkeletonTable, LoadProgressBanner, LoadErrorAlert } from '../SkeletonLoader';
import { useVirtualList } from '../../utils/useVirtualList';
import { useNetworkProfile } from '../../utils/networkProfile';
import { checkRateLimit, validateUploadedFile } from '../../utils/security';
import { supabase } from '../../utils/supabaseClient';
import { runCpuTaskInWorker, executeParallelBatches } from '../../utils/jobQueue';
import { idbSetQuery } from '../../utils/queryPersister';
import {
  ERRORES_COMPRAS,
  OBSERVACIONES_COMPRAS,
  RESULTADOS_COMPRAS,
  LISTA_RESULTADOS_COMPRAS,
  descripcionTipoDocCompras,
} from '../../utils/compras/catalogos';
import { enriquecerComprasConUsuariosSap } from '../../utils/compras/motor';
import { aFilaBDCompras } from '../../utils/compras/persistencia';
import {
  FILTROS_INICIALES_COMPRAS,
  filtrarDocumentosCompras,
  calcularIndicadoresCompras,
  exportarExcelCompras,
  obtenerDocsSapParaCopiar,
} from '../../utils/compras/reportes';
import { formatoMonto } from '../../utils/ventas/montos';

async function copiarTextoPortapapeles(texto) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      // Fallback a textarea temporal si el navegador bloquea Clipboard API
    }
  }
  if (typeof document === 'undefined') return false;
  const textarea = document.createElement('textarea');
  textarea.value = texto;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
  return ok;
}

const FilaDocumentoCompraV2 = memo(function FilaDocumentoCompraV2({
  d,
  onSelectDoc,
  onFilterResultado,
  onFilterCodigo,
  onFilterUsuario,
}) {
  const resInfo = RESULTADOS_COMPRAS[d.resultado] || RESULTADOS_COMPRAS.OK;
  const ambos = d.en_sap && d.en_sunat;
  const docSap = d.en_sap ? (d.sap?.doc_interno || d.nro_doc_sap || '') : '';
  const usuarioSap = d.en_sap ? (d.sap?.usuario_sap || d.usuario_sap || '') : '';

  const diffFecha = ambos && (d.sap?.fecha_emision || null) !== (d.sunat?.fecha_emision || null);
  const diffBase = ambos && (d.sap?.base ?? 0) !== (d.sunat?.base ?? 0);
  const diffIgv = ambos && (d.sap?.igv ?? 0) !== (d.sunat?.igv ?? 0);
  const diffAdq = ambos && (d.sap?.valor_adquisicion ?? 0) !== (d.sunat?.valor_adquisicion ?? 0);
  const diffOtros = ambos && (d.sap?.otros ?? 0) !== (d.sunat?.otros ?? 0);
  const diffTotal = ambos && (d.sap?.total ?? 0) !== (d.sunat?.total ?? 0);
  const errTipo = d.codigosError.includes('ERROR 8');

  return (
    <tr
      style={{ cursor: 'pointer' }}
      onClick={() => onSelectDoc(d)}
      title="Haga clic para ver el detalle comparativo SAP vs. SUNAT"
    >
      {/* 1. N° Documento SAP */}
      <td className="font-mono fw-semibold text-primary">
        {docSap || <span className="text-muted fw-normal">—</span>}
      </td>

      {/* 2. Usuario SAP (opcional, desde Excel BKPF) */}
      <td>
        {usuarioSap ? (
          <span
            className="badge font-mono"
            style={{
              backgroundColor: 'rgba(37, 99, 235, 0.1)',
              color: '#1D4ED8',
              fontSize: '0.7rem',
              cursor: 'pointer',
            }}
            title="Clic para filtrar por este usuario SAP"
            onClick={(e) => {
              e.stopPropagation();
              onFilterUsuario(usuarioSap);
            }}
          >
            {usuarioSap}
          </span>
        ) : (
          <span className="text-muted" style={{ fontSize: '0.73rem' }}>—</span>
        )}
      </td>

      {/* 3. RUC del proveedor */}
      <td className="font-mono fw-semibold">{d.ruc_proveedor || '—'}</td>

      {/* 2. Razón social */}
      <td className="text-truncate" style={{ maxWidth: '170px' }} title={d.razon_social || ''}>
        {d.razon_social || <span className="text-muted">—</span>}
      </td>

      {/* 3. Tipo de documento */}
      <td className={errTipo ? 'cell-mismatch' : ''}>
        <span className="font-mono">{d.tipo_doc_pago || '—'}</span>
        <span className="text-muted ms-1" style={{ fontSize: '0.73rem' }}>
          {descripcionTipoDocCompras(d.tipo_doc_pago).split(' - ')[1] || ''}
        </span>
      </td>

      {/* 4. Serie */}
      <td className="font-mono fw-semibold">{d.serie || '—'}</td>

      {/* 5. Correlativo (preserva ceros a la izquierda) */}
      <td className="font-mono fw-semibold">{d.correlativo || '—'}</td>

      {/* 6. Fecha de emisión SAP */}
      <td className={`font-mono ${diffFecha || !d.en_sap ? 'cell-mismatch' : ''}`}>
        {d.en_sap ? (d.sap.fecha_emision || '—') : 'NO EXISTE'}
      </td>

      {/* 7. Fecha de emisión SUNAT */}
      <td className={`font-mono ${diffFecha || (!d.en_sunat && d.tipo_doc_pago !== '14') ? 'cell-mismatch' : ''}`}>
        {d.en_sunat ? (d.sunat.fecha_emision || '—') : d.tipo_doc_pago === '14' ? 'Exento (14)' : 'NO EXISTE'}
      </td>

      {/* 8-9. Base SAP / SUNAT */}
      <td className={`text-end font-mono col-group-bi col-pair-start ${diffBase ? 'cell-mismatch' : ''}`}>
        {d.en_sap ? formatoMonto(d.sap.base) : '—'}
      </td>
      <td className={`text-end font-mono col-group-bi col-pair-end ${diffBase ? 'cell-mismatch' : ambos ? 'cell-match' : ''}`}>
        {d.en_sunat ? formatoMonto(d.sunat.base) : '—'}
      </td>

      {/* 10-11. IGV SAP / SUNAT */}
      <td className={`text-end font-mono col-group-igv col-pair-start ${diffIgv ? 'cell-mismatch' : ''}`}>
        {d.en_sap ? formatoMonto(d.sap.igv) : '—'}
      </td>
      <td className={`text-end font-mono col-group-igv col-pair-end ${diffIgv ? 'cell-mismatch' : ambos ? 'cell-match' : ''}`}>
        {d.en_sunat ? formatoMonto(d.sunat.igv) : '—'}
      </td>

      {/* 12-13. Valor de adquisición SAP / SUNAT */}
      <td className={`text-end font-mono col-group-adq col-pair-start ${diffAdq ? 'cell-mismatch' : ''}`}>
        {d.en_sap ? formatoMonto(d.sap.valor_adquisicion) : '—'}
      </td>
      <td className={`text-end font-mono col-group-adq col-pair-end ${diffAdq ? 'cell-mismatch' : ambos ? 'cell-match' : ''}`}>
        {d.en_sunat ? formatoMonto(d.sunat.valor_adquisicion) : '—'}
      </td>

      {/* 14-15. Otros tributos / cargos SAP / SUNAT */}
      <td className={`text-end font-mono col-group-otros col-pair-start ${diffOtros ? 'cell-mismatch' : ''}`}>
        {d.en_sap ? formatoMonto(d.sap.otros) : '—'}
      </td>
      <td className={`text-end font-mono col-group-otros col-pair-end ${diffOtros ? 'cell-mismatch' : ambos ? 'cell-match' : ''}`}>
        {d.en_sunat ? formatoMonto(d.sunat.otros) : '—'}
      </td>

      {/* 16-17. Total SAP / SUNAT */}
      <td className={`text-end font-mono fw-semibold col-group-total col-pair-start ${diffTotal ? 'cell-mismatch' : ''}`}>
        {d.en_sap ? formatoMonto(d.sap.total) : '—'}
      </td>
      <td className={`text-end font-mono fw-semibold col-group-total col-pair-end ${diffTotal ? 'cell-mismatch' : ambos ? 'cell-match' : ''}`}>
        {d.en_sunat ? formatoMonto(d.sunat.total) : '—'}
      </td>

      {/* 18. Estado de validación */}
      <td
        className="text-center"
        onClick={(e) => {
          e.stopPropagation();
          onFilterResultado(d.resultado);
        }}
      >
        <span className={`badge badge-status badge-status-${resInfo.clase}`}>
          {resInfo.etiqueta}
        </span>
      </td>

      {/* 19. Errores detectados */}
      <td>
        <div className="d-flex flex-wrap gap-1">
          {d.codigosError.length === 0 ? (
            <span className="text-muted" style={{ fontSize: '0.73rem' }}>—</span>
          ) : (
            d.codigosError.map((cod) => (
              <span
                key={cod}
                className="badge badge-status badge-status-error"
                style={{ cursor: 'pointer', fontSize: '0.67rem' }}
                title="Clic para filtrar por este error"
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
      </td>

      {/* 20. Observaciones detectadas + botón detalle */}
      <td>
        <div className="d-flex align-items-center justify-content-between gap-1">
          <div className="d-flex flex-wrap gap-1">
            {d.codigosObs.length === 0 ? (
              <span className="text-muted" style={{ fontSize: '0.73rem' }}>—</span>
            ) : (
              d.codigosObs.map((cod) => (
                <span
                  key={cod}
                  className="badge badge-status badge-status-observado"
                  style={{ cursor: 'pointer', fontSize: '0.67rem' }}
                  title="Clic para filtrar por esta observación"
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

const ConciliacionCompras = memo(function ConciliacionCompras({
  periodId,
  activePeriod,
  initialFilter,
  onFilterReset,
  activeCompany,
  userProfile,
}) {
  const queryClient = useQueryClient();
  const {
    data: todosDocs = [],
    isLoading,
    isError,
    error,
    refetch,
    loadProgress,
  } = useDocumentosCompras(periodId, true);
  const networkProfile = useNetworkProfile();
  const inputUsuariosSapRef = useRef(null);

  const [filtros, setFiltros] = useState(FILTROS_INICIALES_COMPRAS);
  const [rucInput, setRucInput] = useState('');
  const [razonInput, setRazonInput] = useState('');
  const [docSapInput, setDocSapInput] = useState('');
  const [ocultarSinIncidencias, setOcultarSinIncidencias] = useState(false);
  const [mostrarMenuExportar, setMostrarMenuExportar] = useState(false);
  const [mostrarMenuCopiar, setMostrarMenuCopiar] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [subiendoUsuarios, setSubiendoUsuarios] = useState(false);
  const [copiadoReciente, setCopiadoReciente] = useState(null);
  const [bannerAviso, setBannerAviso] = useState(null);
  const [docSeleccionado, setDocSeleccionado] = useState(null);

  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(() => networkProfile.recommendedPageSize || 20);

  // Debounce RUC, Razón Social y N° Documento SAP
  useEffect(() => {
    const t = setTimeout(() => {
      setFiltros((prev) => ({ ...prev, ruc: rucInput, razonSocial: razonInput, docSap: docSapInput }));
      setPagina(1);
    }, 220);
    return () => clearTimeout(t);
  }, [rucInput, razonInput, docSapInput]);

  // Recibir filtro inicial desde Dashboard
  useEffect(() => {
    if (!initialFilter) return;
    if (typeof initialFilter === 'object') {
      if (initialFilter.filtros) {
        setFiltros({ ...FILTROS_INICIALES_COMPRAS, ...initialFilter.filtros });
      }
    } else if (typeof initialFilter === 'string') {
      if (RESULTADOS_COMPRAS[initialFilter]) {
        setFiltros({ ...FILTROS_INICIALES_COMPRAS, resultado: initialFilter });
      } else if (initialFilter === 'ALL') {
        setFiltros(FILTROS_INICIALES_COMPRAS);
      } else if (initialFilter === 'ERROR') {
        setFiltros({ ...FILTROS_INICIALES_COMPRAS, resultado: 'CON_DIFERENCIAS' });
      } else if (initialFilter === 'OBSERVADO') {
        setFiltros({ ...FILTROS_INICIALES_COMPRAS, resultado: 'CON_OBSERVACIONES' });
      } else if (initialFilter.startsWith('ERROR ') || initialFilter.startsWith('OBS ')) {
        setFiltros({ ...FILTROS_INICIALES_COMPRAS, codigos: [initialFilter] });
      }
    }
    setPagina(1);
    if (onFilterReset) onFilterReset();
  }, [initialFilter, onFilterReset]);

  const docsFiltrados = useMemo(
    () => filtrarDocumentosCompras(todosDocs, filtros),
    [todosDocs, filtros]
  );

  // Conteos para los chips de incidencias (sin el filtro de chips activo para permitir multi-selección intuitiva)
  const conteoPorCodigoBase = useMemo(() => {
    const base = filtrarDocumentosCompras(todosDocs, { ...filtros, codigos: [] });
    return calcularIndicadoresCompras(base).porCodigo;
  }, [todosDocs, filtros]);

  // Tipos de documento presentes en el período + los estándar (01, 07, 09, 14)
  const tiposDocumentoDisponibles = useMemo(() => {
    const set = new Set(['01', '07', '09', '14']);
    for (const d of todosDocs) {
      if (d.tipo_doc_pago) set.add(d.tipo_doc_pago);
    }
    return [...set].sort();
  }, [todosDocs]);

  // Usuarios SAP disponibles (cuando se cargó el Excel opcional BKPF)
  const usuariosSapDisponibles = useMemo(() => {
    const set = new Set();
    for (const d of todosDocs) {
      const u = (d.sap?.usuario_sap || d.usuario_sap || '').trim();
      if (u) set.add(u);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [todosDocs]);

  const totalConUsuarioSap = useMemo(
    () => todosDocs.filter((d) => !!(d.sap?.usuario_sap || d.usuario_sap)).length,
    [todosDocs]
  );

  // Listas completas de N° de documento SAP para copiar (SIEMPRE ignorando paginación)
  const docsSapErrorPeriodo = useMemo(
    () => obtenerDocsSapParaCopiar(todosDocs, { soloConError: true }),
    [todosDocs]
  );
  const docsSapErrorFiltrados = useMemo(
    () => obtenerDocsSapParaCopiar(docsFiltrados, { soloConError: true }),
    [docsFiltrados]
  );
  const docsSapTodosFiltrados = useMemo(
    () => obtenerDocsSapParaCopiar(docsFiltrados, { soloConError: false }),
    [docsFiltrados]
  );

  const totalRegistros = docsFiltrados.length;
  const totalPaginas = Math.ceil(totalRegistros / porPagina);
  const filasPagina = useMemo(
    () => docsFiltrados.slice((pagina - 1) * porPagina, pagina * porPagina),
    [docsFiltrados, pagina, porPagina]
  );

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

  const toggleCodigoIncidencia = useCallback((codigo) => {
    setFiltros((prev) => {
      const existe = prev.codigos.includes(codigo);
      const nuevos = existe ? prev.codigos.filter((c) => c !== codigo) : [...prev.codigos, codigo];
      return { ...prev, codigos: nuevos };
    });
    setPagina(1);
  }, []);

  const seleccionarSoloCodigo = useCallback((codigo) => {
    setFiltros((prev) => ({
      ...prev,
      resultado: 'ALL',
      tipoError: 'ALL',
      tipoObs: 'ALL',
      codigos: [codigo],
    }));
    setPagina(1);
  }, []);

  const filtrarPorResultado = useCallback((res) => {
    setFiltros((prev) => ({ ...prev, resultado: res }));
    setPagina(1);
  }, []);

  const filtrarPorUsuarioSap = useCallback((usuario) => {
    setFiltros((prev) => ({ ...prev, usuarioSap: usuario }));
    setPagina(1);
  }, []);

  const limpiarTodosLosFiltros = useCallback(() => {
    setRucInput('');
    setRazonInput('');
    setDocSapInput('');
    setFiltros(FILTROS_INICIALES_COMPRAS);
    setPagina(1);
  }, []);

  const cerrarModal = useCallback(() => setDocSeleccionado(null), []);

  const hayFiltrosActivos =
    filtros.ruc !== '' ||
    filtros.razonSocial !== '' ||
    filtros.docSap !== '' ||
    filtros.usuarioSap !== 'ALL' ||
    filtros.resultado !== 'ALL' ||
    filtros.tipoError !== 'ALL' ||
    filtros.tipoObs !== 'ALL' ||
    filtros.codigos.length > 0 ||
    filtros.tipoDoc !== 'ALL' ||
    filtros.serie !== '' ||
    filtros.origen !== 'ALL' ||
    filtros.fechaDesde !== '' ||
    filtros.fechaHasta !== '';

  const handleCopiarDocsSap = async (modo = 'auto') => {
    setMostrarMenuCopiar(false);
    let seleccion;
    let etiqueta;

    if (modo === 'error_periodo') {
      seleccion = docsSapErrorPeriodo;
      etiqueta = 'con error (todo el período)';
    } else if (modo === 'error_filtrado') {
      seleccion = docsSapErrorFiltrados;
      etiqueta = 'con error (filtros actuales)';
    } else if (modo === 'todos_filtrados') {
      seleccion = docsSapTodosFiltrados;
      etiqueta = 'de la vista filtrada';
    } else if (hayFiltrosActivos && docsSapErrorFiltrados.total > 0) {
      seleccion = docsSapErrorFiltrados;
      etiqueta = 'con error (filtros actuales)';
    } else {
      seleccion = docsSapErrorPeriodo;
      etiqueta = 'con error (todo el período)';
    }

    if (seleccion.total === 0) {
      const tieneErroresSapSinNro = todosDocs.some(
        (d) => d.en_sap && d.codigosError.length > 0 && !(d.sap?.doc_interno || d.nro_doc_sap)
      );
      setBannerAviso({
        tipo: 'warning',
        texto: tieneErroresSapSinNro
          ? 'No hay N° de documento SAP registrados en este período (cargado antes de esta función). Vuelva a cargar el archivo TXT de SAP para habilitar el copiado.'
          : 'No se encontraron documentos SAP para copiar en la selección actual.',
      });
      return;
    }

    const ok = await copiarTextoPortapapeles(seleccion.texto);
    if (!ok) {
      setBannerAviso({
        tipo: 'danger',
        texto: 'No se pudo acceder al portapapeles del navegador. Verifique los permisos e intente nuevamente.',
      });
      return;
    }

    setCopiadoReciente(seleccion.total);
    setTimeout(() => setCopiadoReciente(null), 2800);
    setBannerAviso({
      tipo: 'success',
      texto: `Se copiaron ${seleccion.total.toLocaleString('es-PE')} N° de documento SAP ${etiqueta} (todas las páginas, uno por línea). Péguelos en SAP para exportar el Excel de usuarios y luego súbalo con el botón "Subir Usuarios SAP (.xlsx)".`,
    });
  };

  const handleSubirUsuariosSap = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const check = validateUploadedFile(file, 'excel');
    if (!check.valid) {
      setBannerAviso({ tipo: 'danger', texto: check.error });
      return;
    }

    setSubiendoUsuarios(true);
    setBannerAviso(null);
    try {
      const buffer = await file.arrayBuffer();
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const filas = XLSX.utils.sheet_to_json(firstSheet, { raw: false, defval: '' });

      const lectura = await runCpuTaskInWorker('PARSE_USUARIOS_SAP_COMPRAS', { filas });
      if (lectura.estado === 'error') {
        setBannerAviso({ tipo: 'danger', texto: lectura.mensaje });
        return;
      }

      const cruce = enriquecerComprasConUsuariosSap(todosDocs, lectura.registros);
      if (cruce.totalCoincidencias === 0) {
        const notaPeriodoAntiguo =
          cruce.totalConDocSap === 0
            ? ' Este período no tiene N° de documento SAP registrados; vuelva a cargar el TXT de SAP para habilitar el cruce.'
            : '';
        setBannerAviso({
          tipo: 'warning',
          texto: `Se leyeron ${lectura.registrosValidos.toLocaleString('es-PE')} registros del Excel "${file.name}", pero ninguno coincidió con los N° de documento SAP de este período.${notaPeriodoAntiguo}`,
        });
        return;
      }

      // 1. Actualizar caché en memoria (React Query) e IndexedDB inmediatamente
      queryClient.setQueryData(['comprasDocumentos', periodId], cruce.docs);
      idbSetQuery(JSON.stringify(['comprasDocumentos', periodId]), ['comprasDocumentos', periodId], cruce.docs);

      // 2. Persistir los documentos actualizados en Supabase si el usuario tiene rol de escritura
      const canPersist = userProfile?.rol === 'admin' || userProfile?.rol === 'operador';
      let guardadoBD = false;
      let errorPersistencia = null;

      if (canPersist && periodId && activeCompany?.id) {
        try {
          const filasActualizadas = cruce.docsActualizados.map((doc) =>
            aFilaBDCompras(doc, { periodoId, empresaId: activeCompany.id })
          );
          await executeParallelBatches(
            filasActualizadas,
            Math.min(300, networkProfile.recommendedBatchSize || 300),
            async (chunk) => {
              const { error } = await supabase
                .from('detalle_compras')
                .upsert(chunk, { onConflict: 'periodo_id,car_sunat' });
              if (error) throw error;
            },
            {
              concurrency: Math.min(2, networkProfile.recommendedConcurrency || 2),
              label: 'UpsertUsuariosSapCompras',
            }
          );
          guardadoBD = true;
        } catch (persistErr) {
          console.error('No se pudo persistir Usuarios SAP en Supabase:', persistErr);
          errorPersistencia = persistErr?.message || 'Error al guardar en base de datos';
        }
      }

      const extraNoMatch =
        cruce.sinCoincidenciaExcel > 0
          ? ` (${cruce.sinCoincidenciaExcel.toLocaleString('es-PE')} del Excel no figuraban en este período)`
          : '';
      const notaGuardado = guardadoBD
        ? ' Guardado en base de datos.'
        : errorPersistencia
          ? ` Aplicado en esta vista (no se pudo guardar en BD: ${errorPersistencia}).`
          : ' Aplicado en esta vista y listo para exportar a Excel.';

      setBannerAviso({
        tipo: errorPersistencia ? 'warning' : 'success',
        texto: `Excel "${file.name}" procesado: ${cruce.totalCoincidencias.toLocaleString('es-PE')} documento(s) actualizados con su Usuario SAP${extraNoMatch}.${notaGuardado}`,
      });
    } catch (err) {
      console.error('Error al procesar Excel de Usuarios SAP:', err);
      setBannerAviso({
        tipo: 'danger',
        texto: err?.message || 'Ocurrió un error al leer el archivo Excel de Usuarios SAP.',
      });
    } finally {
      setSubiendoUsuarios(false);
    }
  };

  const handleExportar = async (alcance) => {
    const rl = checkRateLimit('excel_export_compras', { maxAttempts: 10, windowMs: 60000, lockoutMs: 60000 });
    if (!rl.allowed) {
      alert(rl.message);
      return;
    }
    setMostrarMenuExportar(false);
    setExportando(true);
    try {
      await exportarExcelCompras({
        docs: alcance === 'filtrado' ? docsFiltrados : todosDocs,
        alcance,
        periodo: activePeriod || 'periodo',
      });
    } catch (err) {
      console.error('Error al exportar Compras a Excel:', err);
    } finally {
      setExportando(false);
    }
  };

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

  return (
    <div className="animate-fade-in">
      {/* Panel de Filtros Rápidos por Errores (1-8) y Observaciones (1-3) */}
      <div className="incidence-filter-panel mb-3">
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
          <div className="d-flex align-items-center gap-2">
            <FiFilter className="text-primary" />
            <span className="fw-bold" style={{ fontSize: '0.88rem', color: 'var(--color-text)' }}>
              Filtro Rápido por Errores (1–8) y Observaciones (1–3)
            </span>
            <span className="text-muted" style={{ fontSize: '0.76rem' }}>
              (selección individual o múltiple)
            </span>
          </div>
          <div className="d-flex align-items-center gap-3">
            <div className="form-check form-switch mb-0 d-flex align-items-center gap-1.5">
              <input
                id="switch-compras-ocultar-ceros"
                type="checkbox"
                className="form-check-input m-0"
                style={{ cursor: 'pointer' }}
                checked={ocultarSinIncidencias}
                onChange={(e) => setOcultarSinIncidencias(e.target.checked)}
              />
              <label
                htmlFor="switch-compras-ocultar-ceros"
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
          {/* Errores 1 al 8 */}
          <div className="col-lg-8">
            <div className="incidence-section-box">
              <div className="incidence-section-header">
                <span className="fw-bold text-danger" style={{ fontSize: '0.72rem', letterSpacing: '0.04em' }}>
                  ERRORES DETECTADOS (ERROR 1 – ERROR 8)
                </span>
                <span className="font-mono text-muted" style={{ fontSize: '0.7rem' }}>
                  {ERRORES_COMPRAS.reduce((acc, i) => acc + (conteoPorCodigoBase[i.codigo] || 0), 0).toLocaleString('es-PE')} hallazgos
                </span>
              </div>
              <div className="incidence-grid">
                {ERRORES_COMPRAS.filter(
                  (inc) => !ocultarSinIncidencias || (conteoPorCodigoBase[inc.codigo] || 0) > 0 || filtros.codigos.includes(inc.codigo)
                ).map((inc) => {
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

          {/* Observaciones 1 al 3 */}
          <div className="col-lg-4">
            <div className="incidence-section-box">
              <div className="incidence-section-header">
                <span className="fw-bold text-warning" style={{ fontSize: '0.72rem', letterSpacing: '0.04em' }}>
                  OBSERVACIONES (OBS 1 – OBS 3)
                </span>
                <span className="font-mono text-muted" style={{ fontSize: '0.7rem' }}>
                  {OBSERVACIONES_COMPRAS.reduce((acc, i) => acc + (conteoPorCodigoBase[i.codigo] || 0), 0).toLocaleString('es-PE')} hallazgos
                </span>
              </div>
              <div className="incidence-grid">
                {OBSERVACIONES_COMPRAS.filter(
                  (inc) => !ocultarSinIncidencias || (conteoPorCodigoBase[inc.codigo] || 0) > 0 || filtros.codigos.includes(inc.codigo)
                ).map((inc) => {
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

      {/* Contenedor principal de Tabla y Filtros */}
      <div className="card-premium mb-4">
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <h4 className="mb-0 fw-bold">
              Tabla de Conciliación de Compras ({docsFiltrados.length.toLocaleString('es-PE')})
            </h4>
            <select
              className="form-select form-control-premium"
              style={{ width: 'auto', minWidth: '108px', fontSize: '0.84rem' }}
              value={porPagina}
              onChange={(e) => {
                setPorPagina(parseInt(e.target.value, 10));
                setPagina(1);
              }}
            >
              <option value={15}>15 filas</option>
              <option value={20}>20 filas</option>
              <option value={50}>50 filas</option>
              <option value={100}>100 filas</option>
              <option value={250}>250 filas</option>
              <option value={500}>500 filas</option>
            </select>
          </div>

          {/* Acciones de tabla: Copiar Docs SAP con error, Subir Usuarios SAP (.xlsx) y Exportar a Excel */}
          <div className="d-flex align-items-center flex-wrap gap-2">
            {/* Botón dividido para copiar TODOS los N° Doc. SAP con error (ignorando paginación) */}
            <div className="position-relative btn-group">
              <button
                type="button"
                disabled={todosDocs.length === 0}
                className={`btn btn-sm d-flex align-items-center px-3 py-1.5 fw-semibold ${
                  copiadoReciente !== null ? 'btn-success' : 'btn-outline-danger'
                }`}
                style={{ borderTopLeftRadius: '0.5rem', borderBottomLeftRadius: '0.5rem' }}
                title="Copia todos los N° de documento SAP con error en todas las páginas (listo para pegar en SAP SE16N/BKPF)"
                onClick={() => handleCopiarDocsSap('auto')}
              >
                {copiadoReciente !== null ? (
                  <>
                    <FiCheck className="me-1.5" />
                    Copiados ({copiadoReciente.toLocaleString('es-PE')})
                  </>
                ) : (
                  <>
                    <FiCopy className="me-1.5" />
                    Copiar Docs SAP con error (
                    {(hayFiltrosActivos && docsSapErrorFiltrados.total > 0
                      ? docsSapErrorFiltrados.total
                      : docsSapErrorPeriodo.total
                    ).toLocaleString('es-PE')}
                    )
                  </>
                )}
              </button>
              <button
                type="button"
                disabled={todosDocs.length === 0}
                className={`btn btn-sm px-2 py-1.5 ${
                  copiadoReciente !== null ? 'btn-success' : 'btn-outline-danger'
                }`}
                style={{ borderTopRightRadius: '0.5rem', borderBottomRightRadius: '0.5rem' }}
                aria-label="Más opciones de copiado de documentos SAP"
                onClick={() => {
                  setMostrarMenuCopiar((v) => !v);
                  setMostrarMenuExportar(false);
                }}
              >
                <FiChevronDown />
              </button>
              {mostrarMenuCopiar && (
                <ul
                  className="dropdown-premium-menu show"
                  style={{ right: 0, left: 'auto', minWidth: '350px', top: '100%' }}
                  onMouseLeave={() => setMostrarMenuCopiar(false)}
                >
                  <li>
                    <button
                      type="button"
                      className="dropdown-premium-item"
                      style={{ whiteSpace: 'normal', fontSize: '0.8rem' }}
                      disabled={docsSapErrorPeriodo.total === 0}
                      onClick={() => handleCopiarDocsSap('error_periodo')}
                    >
                      <strong>Todos los N° Doc. SAP con error del período</strong> ({docsSapErrorPeriodo.total.toLocaleString('es-PE')} docs · todas las páginas)
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="dropdown-premium-item"
                      style={{ whiteSpace: 'normal', fontSize: '0.8rem' }}
                      disabled={docsSapErrorFiltrados.total === 0}
                      onClick={() => handleCopiarDocsSap('error_filtrado')}
                    >
                      <strong>N° Doc. SAP con error (filtros actuales)</strong> ({docsSapErrorFiltrados.total.toLocaleString('es-PE')} docs · todas las páginas)
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="dropdown-premium-item"
                      style={{ whiteSpace: 'normal', fontSize: '0.8rem' }}
                      disabled={docsSapTodosFiltrados.total === 0}
                      onClick={() => handleCopiarDocsSap('todos_filtrados')}
                    >
                      <strong>Todos los N° Doc. SAP filtrados</strong> ({docsSapTodosFiltrados.total.toLocaleString('es-PE')} docs · incluye OK y Obs.)
                    </button>
                  </li>
                </ul>
              )}
            </div>

            {/* Subida opcional del Excel de Usuarios SAP (BKPF) directo sobre el período actual */}
            <input
              ref={inputUsuariosSapRef}
              type="file"
              accept=".xlsx,.xls"
              className="d-none"
              onChange={handleSubirUsuariosSap}
              disabled={subiendoUsuarios || todosDocs.length === 0}
            />
            <button
              type="button"
              disabled={todosDocs.length === 0 || subiendoUsuarios}
              className={`btn btn-sm d-flex align-items-center px-3 py-1.5 rounded-3 fw-semibold ${
                totalConUsuarioSap > 0 ? 'btn-outline-success' : 'btn-outline-secondary'
              }`}
              title="Subir archivo Excel (.xlsx) exportado de SAP con las columnas 'Nº documento' y 'Nombre del usuario'"
              onClick={() => inputUsuariosSapRef.current?.click()}
            >
              {totalConUsuarioSap > 0 ? <FiUser className="me-1.5" /> : <FiUpload className="me-1.5" />}
              {subiendoUsuarios
                ? 'Cargando Usuarios SAP...'
                : totalConUsuarioSap > 0
                  ? `Usuarios SAP (${totalConUsuarioSap.toLocaleString('es-PE')}) · Actualizar`
                  : 'Subir Usuarios SAP (.xlsx)'}
            </button>

            {/* Menú de exportación a Excel (filtrado vs totalidad) */}
            <div className="position-relative">
              <button
                type="button"
                disabled={todosDocs.length === 0 || exportando}
                className="btn btn-outline-primary btn-sm d-flex align-items-center px-3 py-1.5 rounded-3 fw-semibold"
                onClick={() => {
                  setMostrarMenuExportar((v) => !v);
                  setMostrarMenuCopiar(false);
                }}
              >
                <FiDownload className="me-1.5" />
                {exportando ? 'Exportando Excel...' : 'Exportar a Excel'}
                <FiChevronDown className="ms-1" />
              </button>
              {mostrarMenuExportar && (
                <ul
                  className="dropdown-premium-menu show"
                  style={{ right: 0, left: 'auto', minWidth: '330px' }}
                  onMouseLeave={() => setMostrarMenuExportar(false)}
                >
                  <li>
                    <button
                      type="button"
                      className="dropdown-premium-item"
                      style={{ whiteSpace: 'normal', fontSize: '0.8rem' }}
                      disabled={docsFiltrados.length === 0}
                      onClick={() => handleExportar('filtrado')}
                    >
                      <strong>Exportar con filtros aplicados</strong> ({docsFiltrados.length.toLocaleString('es-PE')} docs · 8 hojas)
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="dropdown-premium-item"
                      style={{ whiteSpace: 'normal', fontSize: '0.8rem' }}
                      onClick={() => handleExportar('completo')}
                    >
                      <strong>Exportar totalidad de resultados</strong> ({todosDocs.length.toLocaleString('es-PE')} docs · 8 hojas)
                    </button>
                  </li>
                </ul>
              )}
            </div>
          </div>
        </div>

        {bannerAviso && (
          <div
            className={`alert alert-${bannerAviso.tipo} d-flex align-items-center justify-content-between gap-2 py-2 px-3 mb-3 border-0 rounded-3`}
            style={{ fontSize: '0.82rem' }}
          >
            <div>{bannerAviso.texto}</div>
            <button
              type="button"
              className="btn btn-sm btn-link text-reset p-0 flex-shrink-0"
              aria-label="Cerrar aviso"
              onClick={() => setBannerAviso(null)}
            >
              <FiX />
            </button>
          </div>
        )}

        {/* 7.C Filtros — Fila 1 */}
        <div className="row g-2 mb-2">
          <div className="col-lg-3">
            <div className="input-group">
              <span className="input-group-text border" style={{ backgroundColor: '#F8FAFC', borderColor: 'var(--border-color)', color: '#64748B', fontSize: '0.8rem' }}>
                <FiSearch className="me-1" /> RUC
              </span>
              <input
                type="text"
                className="form-control form-control-premium font-mono"
                placeholder="RUC del proveedor..."
                value={rucInput}
                onChange={(e) => setRucInput(e.target.value)}
              />
            </div>
          </div>

          <div className="col-lg-3">
            <div className="input-group">
              <span className="input-group-text border" style={{ backgroundColor: '#F8FAFC', borderColor: 'var(--border-color)', color: '#64748B', fontSize: '0.8rem' }}>
                Razón Social
              </span>
              <input
                type="text"
                className="form-control form-control-premium"
                placeholder="Nombre del proveedor..."
                value={razonInput}
                onChange={(e) => setRazonInput(e.target.value)}
              />
            </div>
          </div>

          <div className="col-lg-2">
            <select
              className="form-select form-control-premium"
              value={filtros.resultado}
              onChange={(e) => actualizarFiltro({ resultado: e.target.value })}
            >
              <option value="ALL">Estado: Todos</option>
              {LISTA_RESULTADOS_COMPRAS.map((r) => (
                <option key={r.valor} value={r.valor}>
                  {r.etiqueta}
                </option>
              ))}
            </select>
          </div>

          <div className="col-lg-2">
            <select
              className="form-select form-control-premium"
              value={filtros.tipoError}
              onChange={(e) => actualizarFiltro({ tipoError: e.target.value })}
            >
              <option value="ALL">Tipo de Error: Todos</option>
              {ERRORES_COMPRAS.map((err) => (
                <option key={err.codigo} value={err.codigo}>
                  {err.codigo}: {err.corto}
                </option>
              ))}
            </select>
          </div>

          <div className="col-lg-2">
            <select
              className="form-select form-control-premium"
              value={filtros.tipoObs}
              onChange={(e) => actualizarFiltro({ tipoObs: e.target.value })}
            >
              <option value="ALL">Observación: Todas</option>
              {OBSERVACIONES_COMPRAS.map((obs) => (
                <option key={obs.codigo} value={obs.codigo}>
                  {obs.codigo}: {obs.corto}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 7.C Filtros — Fila 2 */}
        <div className="row g-2 mb-2">
          <div className="col-lg-3">
            <div className="input-group">
              <span className="input-group-text border" style={{ backgroundColor: '#F8FAFC', borderColor: 'var(--border-color)', color: '#64748B', fontSize: '0.8rem' }}>
                N° Doc. SAP
              </span>
              <input
                type="text"
                className="form-control form-control-premium font-mono"
                placeholder="Ej. 1900014801"
                value={docSapInput}
                onChange={(e) => setDocSapInput(e.target.value)}
              />
            </div>
          </div>

          <div className="col-lg-3">
            <select
              className="form-select form-control-premium"
              value={filtros.usuarioSap}
              onChange={(e) => actualizarFiltro({ usuarioSap: e.target.value })}
            >
              <option value="ALL">
                Usuario SAP: Todos{usuariosSapDisponibles.length > 0 ? ` (${usuariosSapDisponibles.length})` : ''}
              </option>
              <option value="SIN_USUARIO">Sin usuario SAP asignado</option>
              {usuariosSapDisponibles.map((usr) => (
                <option key={usr} value={usr}>
                  {usr}
                </option>
              ))}
            </select>
          </div>

          <div className="col-lg-3">
            <select
              className="form-select form-control-premium"
              value={filtros.tipoDoc}
              onChange={(e) => actualizarFiltro({ tipoDoc: e.target.value })}
            >
              <option value="ALL">Tipo de Documento: Todos</option>
              {tiposDocumentoDisponibles.map((cod) => (
                <option key={cod} value={cod}>
                  {descripcionTipoDocCompras(cod)}
                </option>
              ))}
            </select>
          </div>

          <div className="col-lg-3">
            <div className="input-group">
              <span className="input-group-text border" style={{ backgroundColor: '#F8FAFC', borderColor: 'var(--border-color)', color: '#64748B', fontSize: '0.8rem' }}>
                Serie
              </span>
              <input
                type="text"
                className="form-control form-control-premium font-mono"
                placeholder="Ej. F001"
                value={filtros.serie}
                onChange={(e) => actualizarFiltro({ serie: e.target.value })}
              />
            </div>
          </div>
        </div>

        {/* 7.C Filtros — Fila 3 */}
        <div className="row g-2 mb-3">
          <div className="col-lg-3">
            <div className="input-group">
              <span className="input-group-text border" style={{ backgroundColor: '#F8FAFC', borderColor: 'var(--border-color)', color: '#64748B', fontSize: '0.8rem' }}>
                Desde
              </span>
              <input
                type="date"
                className="form-control form-control-premium"
                value={filtros.fechaDesde}
                onChange={(e) => actualizarFiltro({ fechaDesde: e.target.value })}
              />
            </div>
          </div>

          <div className="col-lg-3">
            <div className="input-group">
              <span className="input-group-text border" style={{ backgroundColor: '#F8FAFC', borderColor: 'var(--border-color)', color: '#64748B', fontSize: '0.8rem' }}>
                Hasta
              </span>
              <input
                type="date"
                className="form-control form-control-premium"
                value={filtros.fechaHasta}
                onChange={(e) => actualizarFiltro({ fechaHasta: e.target.value })}
              />
            </div>
          </div>

          <div className="col-lg-6 d-flex justify-content-end">
            <button
              type="button"
              disabled={!hayFiltrosActivos}
              className="btn btn-outline-secondary px-4 h-100 d-flex align-items-center justify-content-center py-1.5 rounded-3 fw-semibold"
              style={{ fontSize: '0.82rem' }}
              onClick={limpiarTodosLosFiltros}
            >
              <FiRefreshCw className="me-1" /> Limpiar Filtros
            </button>
          </div>
        </div>

        {/* 7.B Tabla de Conciliación de Compras (20 columnas + virtualización) */}
        {isLoading ? (
          <>
            <LoadProgressBanner progress={loadProgress} />
            <SkeletonTable rows={10} columns={10} title="Cargando documentos conciliados de Compras..." />
          </>
        ) : isError ? (
          <LoadErrorAlert
            title="No se pudieron cargar los documentos de Compras"
            error={error}
            onRetry={refetch}
          />
        ) : totalRegistros === 0 ? (
          <div
            className="text-center py-5 rounded-3"
            style={{ backgroundColor: 'rgba(241, 245, 249, 0.6)', border: '1px dashed var(--border-color)' }}
          >
            <FiAlertCircle className="text-muted fs-1 mb-2" />
            <p className="text-muted mb-0 fw-semibold">
              {todosDocs.length === 0
                ? 'No hay documentos de Compras cargados en este período. Utilice "Carga TXT" para subir SAP y SUNAT.'
                : 'No se encontraron documentos para los filtros seleccionados.'}
            </p>
          </div>
        ) : (
          <>
            <div
              ref={containerRef}
              onScroll={onScroll}
              className="table-responsive"
              style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}
            >
              <table className="table table-hover table-dense align-middle text-nowrap mb-0">
                <thead>
                  <tr>
                    <th>N° Doc. SAP</th>
                    <th>Usuario SAP</th>
                    <th>RUC Proveedor</th>
                    <th>Razón Social</th>
                    <th>Tipo Doc.</th>
                    <th>Serie</th>
                    <th>Correlativo</th>
                    <th>Fecha SAP</th>
                    <th>Fecha SUNAT</th>
                    <th className="text-end col-group-bi col-pair-start">Base SAP</th>
                    <th className="text-end col-group-bi col-pair-end">Base SUNAT</th>
                    <th className="text-end col-group-igv col-pair-start">IGV SAP</th>
                    <th className="text-end col-group-igv col-pair-end">IGV SUNAT</th>
                    <th className="text-end col-group-adq col-pair-start">Val. Adq. SAP</th>
                    <th className="text-end col-group-adq col-pair-end">Val. Adq. SUNAT</th>
                    <th className="text-end col-group-otros col-pair-start">Otros Trib. SAP</th>
                    <th className="text-end col-group-otros col-pair-end">Otros Trib. SUNAT</th>
                    <th className="text-end col-group-total col-pair-start">Total SAP</th>
                    <th className="text-end col-group-total col-pair-end">Total SUNAT</th>
                    <th className="text-center">Estado Validación</th>
                    <th>Errores Detectados</th>
                    <th>Observaciones Detectadas</th>
                  </tr>
                </thead>
                <tbody>
                  {isVirtualized && topPaddingHeight > 0 && (
                    <tr aria-hidden="true">
                      <td colSpan={22} style={{ height: `${topPaddingHeight}px`, padding: 0, border: 0 }} />
                    </tr>
                  )}
                  {filasVirtualizadas.map((d) => (
                    <FilaDocumentoCompraV2
                      key={d.key}
                      d={d}
                      onSelectDoc={setDocSeleccionado}
                      onFilterResultado={filtrarPorResultado}
                      onFilterCodigo={seleccionarSoloCodigo}
                      onFilterUsuario={filtrarPorUsuarioSap}
                    />
                  ))}
                  {isVirtualized && bottomPaddingHeight > 0 && (
                    <tr aria-hidden="true">
                      <td colSpan={22} style={{ height: `${bottomPaddingHeight}px`, padding: 0, border: 0 }} />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {totalPaginas > 1 && (
              <div
                className="d-flex justify-content-between align-items-center mt-3 pt-3 flex-wrap gap-2"
                style={{ borderTop: '1px solid var(--border-color)' }}
              >
                <span className="text-muted" style={{ fontSize: '0.85rem' }}>
                  Mostrando {(pagina - 1) * porPagina + 1} - {Math.min(pagina * porPagina, totalRegistros)} de{' '}
                  {totalRegistros.toLocaleString('es-PE')} documentos.
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

      {/* 7.D Modal de Detalle Comparativo */}
      <ModalDetalleDocumentoCompras
        doc={docSeleccionado}
        onClose={cerrarModal}
        onFiltrarCodigo={seleccionarSoloCodigo}
      />
    </div>
  );
});

export default ConciliacionCompras;
