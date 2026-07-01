import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '../utils/supabaseClient';
import { FiDownload, FiSearch, FiEye, FiX, FiAlertCircle, FiCheckCircle } from 'react-icons/fi';
import * as XLSX from 'xlsx';

const STATIC_ERRORS = [
  { value: "ERROR 1: DIFERENCIA EN LA BI Gravada", label: "ERROR 1: DIFERENCIA EN BI Gravada" },
  { value: "ERROR 2: DIFERENCIA EN EL IGV / IPM", label: "ERROR 2: DIFERENCIA EN IGV / IPM" },
  { value: "ERROR 3: DIFERENCIA EN Mto Exonerado", label: "ERROR 3: DIFERENCIA EN Mto Exonerado" },
  { value: "ERROR 4: DIFERENCIA EN Mto Inafecto", label: "ERROR 4: DIFERENCIA EN Mto Inafecto" },
  { value: "ERROR 5: DIFERENCIA EN TOTALES", label: "ERROR 5: DIFERENCIA EN TOTALES" },
  { value: "ERROR 6: BOLETAS MAYOR A 700 SOLES SIN DNI", label: "ERROR 6: BOLETAS > 700 SIN DNI" }
];

const STATIC_OBSERVATIONS = [
  { value: "OBS 1: DIFERENCIA EN TIPO DE IDENTIDAD", label: "OBS 1: DIFERENCIA TIPO IDENTIDAD" },
  { value: "OBS 2: DIFERENCIA EN NUMERO DE IDENTIDAD", label: "OBS 2: DIFERENCIA NUMERO IDENTIDAD" },
  { value: "OBS 3: DIFERENCIA EN SECUENCIA DE CORRELATIVOS", label: "OBS 3: DIFERENCIA SECUENCIA" },
  { value: "OBS 4: NO EXISTE EN SAP", label: "OBS 4: NO EXISTE EN SAP" },
  { value: "OBS 5: NO EXISTE EN SUNAT", label: "OBS 5: NO EXISTE EN SUNAT" },
  { value: "OBS 6: NÚMERO DE IDENTIDAD SAP INCORRECTO", label: "OBS 6: LONGITUD IDENTIDAD SAP INCORRECTO" },
  { value: "OBS 7: NÚMERO DE IDENTIDAD SUNAT INCORRECTO", label: "OBS 7: LONGITUD IDENTIDAD SUNAT INCORRECTO" }
];

export default function TablaUnificada({ periodId, activePeriod, initialFilter, onFilterReset, activeModule }) {
  const [exportLoading, setExportLoading] = useState(false);

  const getStaticErrors = () => {
    if (activeModule === 'compras') {
      return [
        { value: "ERROR 1: DIFERENCIA EN BASE IMPONIBLE", label: "ERROR 1: DIFERENCIA BASE IMPONIBLE" },
        { value: "ERROR 2: DIFERENCIA EN IGV", label: "ERROR 2: DIFERENCIA IGV" },
        { value: "ERROR 3: DIFERENCIA EN EXONERADO", label: "ERROR 3: DIFERENCIA EXONERADO" },
        { value: "ERROR 4: DIFERENCIA EN MONTOS TOTALES", label: "ERROR 4: DIFERENCIA MONTOS TOTALES" },
        { value: "ERROR 5: NO EXISTE EN SUNAT", label: "ERROR 5: NO EXISTE EN SUNAT" }
      ];
    }
    return [
      { value: "ERROR 1: DIFERENCIA EN LA BI Gravada", label: "ERROR 1: DIFERENCIA BI Gravada" },
      { value: "ERROR 2: DIFERENCIA EN EL IGV / IPM", label: "ERROR 2: DIFERENCIA IGV / IPM" },
      { value: "ERROR 3: DIFERENCIA EN Mto Exonerado", label: "ERROR 3: DIFERENCIA Mto Exonerado" },
      { value: "ERROR 4: DIFERENCIA EN Mto Inafecto", label: "ERROR 4: DIFERENCIA Mto Inafecto" },
      { value: "ERROR 5: DIFERENCIA EN TOTALES", label: "ERROR 5: DIFERENCIA TOTALES" },
      { value: "ERROR 6: BOLETAS MAYOR A 700 SOLES SIN DNI", label: "ERROR 6: BOLETAS > 700 SIN DNI" }
    ];
  };

  const getStaticObservations = () => {
    if (activeModule === 'compras') {
      return [
        { value: "OBS 1: NO EXISTE EN SAP", label: "OBS 1: NO EXISTE EN SAP" },
        { value: "OBS 6: RUC PROVEEDOR INVÁLIDO (SAP)", label: "OBS 6: RUC PROVEEDOR INVÁLIDO (SAP)" },
        { value: "OBS 7: RUC PROVEEDOR INVÁLIDO (SUNAT)", label: "OBS 7: RUC PROVEEDOR INVÁLIDO (SUNAT)" }
      ];
    }
    return [
      { value: "OBS 1: DIFERENCIA EN TIPO DE IDENTIDAD", label: "OBS 1: DIFERENCIA TIPO IDENTIDAD" },
      { value: "OBS 2: DIFERENCIA EN NUMERO DE IDENTIDAD", label: "OBS 2: DIFERENCIA NUMERO IDENTIDAD" },
      { value: "OBS 3: DIFERENCIA EN SECUENCIA DE CORRELATIVOS", label: "OBS 3: DIFERENCIA SECUENCIA" },
      { value: "OBS 4: NO EXISTE EN SAP", label: "OBS 4: NO EXISTE EN SAP" },
      { value: "OBS 5: NO EXISTE EN SUNAT", label: "OBS 5: NO EXISTE EN SUNAT" },
      { value: "OBS 6: NÚMERO DE IDENTIDAD SAP INCORRECTO", label: "OBS 6: LONGITUD IDENTIDAD SAP INCORRECTO" },
      { value: "OBS 7: NÚMERO DE IDENTIDAD SUNAT INCORRECTO", label: "OBS 7: LONGITUD IDENTIDAD SUNAT INCORRECTO" }
    ];
  };

  // Filtros
  const [searchInputValue, setSearchInputValue] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [stateFilter, setStateFilter] = useState('ALL');
  const [subFilter, setSubFilter] = useState('ALL');
  const [docFilter, setDocFilter] = useState('ALL');
  const [sireFilter, setSireFilter] = useState('ALL');
  const [filterObsIdOk, setFilterObsIdOk] = useState('ALL'); // 'ALL', 'SAP_OK', 'SUNAT_OK'

  // Filtros Avanzados (Fechas, Serie y Correlativos)
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [filterSerie, setFilterSerie] = useState('');
  const [startCorr, setStartCorr] = useState('');
  const [endCorr, setEndCorr] = useState('');
  const [originFilter, setOriginFilter] = useState('ALL');

  const handleClearAdvancedFilters = () => {
    setStartDate('');
    setEndDate('');
    setFilterSerie('');
    setStartCorr('');
    setEndCorr('');
    setOriginFilter('ALL');
    setFilterObsIdOk('ALL');
    setCurrentPage(1);
  };

  const { data: existingFilters = { errors: [], obs: [] } } = useQuery({
    queryKey: ['existingFilters', periodId, activeModule],
    queryFn: async () => {
      if (!periodId) return { errors: [], obs: [] };
      const { data, error } = await supabase
        .from(activeModule === 'compras' ? 'detalle_compras' : 'detalle_ventas')
        .select('errores_json')
        .eq('periodo_id', periodId)
        .neq('estado_validacion', 'OK');

      if (error) throw error;

      const errorsSet = new Set();
      const obsSet = new Set();

      if (data) {
        data.forEach(row => {
          if (row.errores_json) {
            row.errores_json.forEach(err => {
              if (err.startsWith('ERROR ')) {
                errorsSet.add(err);
              } else if (err.startsWith('OBS ')) {
                obsSet.add(err);
              }
            });
          }
        });
      }

      return {
        errors: Array.from(errorsSet),
        obs: Array.from(obsSet)
      };
    },
    enabled: !!periodId
  });

  const visibleErrors = getStaticErrors().filter(err => 
    existingFilters.errors.some(dbErr => dbErr.startsWith(err.value.slice(0, 8)))
  );

  const visibleObservations = getStaticObservations().filter(obs => 
    existingFilters.obs.some(dbObs => dbObs.startsWith(obs.value.slice(0, 6)))
  );

  // Control sincrónico de cambio de filtros para evitar race conditions
  const handleStateFilterChange = (newVal) => {
    setSubFilter('ALL');
    setStateFilter(newVal);
    setFilterObsIdOk('ALL');
    setCurrentPage(1);
  };

  // Si hay un filtro inicial del dashboard, aplicarlo
  useEffect(() => {
    if (initialFilter) {
      if (initialFilter === 'SAP_OBS_ID_OK') {
        setStateFilter('OBSERVADO');
        setOriginFilter('SAP');
        setSubFilter('ALL');
        setFilterObsIdOk('SAP_OK');
      } else if (initialFilter === 'SUNAT_OBS_ID_OK') {
        setStateFilter('OBSERVADO');
        setOriginFilter('SUNAT');
        setSubFilter('ALL');
        setFilterObsIdOk('SUNAT_OK');
      } else if (initialFilter === 'SAP_OK') {
        setStateFilter('OK');
        setOriginFilter('SAP');
        setSubFilter('ALL');
        setFilterObsIdOk('ALL');
      } else if (initialFilter === 'SUNAT_OK') {
        setStateFilter('OK');
        setOriginFilter('SUNAT');
        setSubFilter('ALL');
        setFilterObsIdOk('ALL');
      } else {
        setOriginFilter('ALL');
        setStateFilter(initialFilter);
        setSubFilter('ALL');
        setFilterObsIdOk('ALL');
      }
      setCurrentPage(1);
      if (onFilterReset) {
        onFilterReset();
      }
    }
  }, [initialFilter, onFilterReset]);

  // Modal para ver errores
  const [selectedRow, setSelectedRow] = useState(null);

  // Paginación
  const [currentPage, setCurrentPage] = useState(1);
  const [recordsPerPage, setRecordsPerPage] = useState(20);

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setSearchTerm(searchInputValue);
      setCurrentPage(1); // Reiniciar a página 1 en búsquedas
    }, 400);
    return () => clearTimeout(handler);
  }, [searchInputValue]);

  // TanStack Query para obtener registros filtrados y paginados
  const { data: reconciliationData, isLoading } = useQuery({
    queryKey: ['reconciliation', periodId, currentPage, searchTerm, stateFilter, subFilter, docFilter, sireFilter, recordsPerPage, startDate, endDate, filterSerie, startCorr, endCorr, originFilter, filterObsIdOk, activeModule],
    queryFn: async () => {
      let query = supabase
        .from(activeModule === 'compras' ? 'detalle_compras' : 'detalle_ventas')
        .select('*', { count: 'exact' })
        .eq('periodo_id', periodId);

      if (originFilter === 'SAP') {
        query = query.or('nro_identidad_sap.not.is.null,nombre_sap.not.is.null');
      } else if (originFilter === 'SUNAT') {
        query = query.or('nro_identidad_sunat.not.is.null,nombre_sunat.not.is.null');
      }

      if (filterSerie) {
        query = query.ilike('serie', `%${filterSerie.trim()}%`);
      }
      if (startDate) {
        query = query.gte('fecha_emision', startDate);
      }
      if (endDate) {
        query = query.lte('fecha_emision', endDate);
      }
      if (startCorr) {
        const startInt = parseInt(startCorr, 10);
        if (!isNaN(startInt)) {
          query = query.gte('correlativo_int', startInt);
        }
      }
      if (endCorr) {
        const endInt = parseInt(endCorr, 10);
        if (!isNaN(endInt)) {
          query = query.lte('correlativo_int', endInt);
        }
      }

      if (searchTerm.trim() !== '') {
        const term = `%${searchTerm.trim()}%`;
        query = query.or(`buscar_documento.ilike.${term},serie.ilike.${term},correlativo.ilike.${term},nro_identidad_sunat.ilike.${term},nro_identidad_sap.ilike.${term},nombre_sunat.ilike.${term},nombre_sap.ilike.${term}`);
      }

      if (stateFilter !== 'ALL') {
        query = query.eq('estado_validacion', stateFilter);
        if (stateFilter === 'ERROR' && subFilter !== 'ALL') {
          query = query.contains('errores_json', JSON.stringify([subFilter]));
        } else if (stateFilter === 'OBSERVADO') {
          if (subFilter !== 'ALL') {
            query = query.contains('errores_json', JSON.stringify([subFilter]));
          }
          if (filterObsIdOk === 'SAP_OK') {
            const errorString = activeModule === 'compras' ? "OBS 6: RUC PROVEEDOR INVÁLIDO (SAP)" : "OBS 6: NÚMERO DE IDENTIDAD SAP INCORRECTO";
            query = query.not('errores_json', 'cs', JSON.stringify([errorString]));
          } else if (filterObsIdOk === 'SUNAT_OK') {
            const errorString = activeModule === 'compras' ? "OBS 7: RUC PROVEEDOR INVÁLIDO (SUNAT)" : "OBS 7: NÚMERO DE IDENTIDAD SUNAT INCORRECTO";
            query = query.not('errores_json', 'cs', JSON.stringify([errorString]));
          }
        }
      }

      if (docFilter !== 'ALL') {
        query = query.eq('tipo_doc_pago', docFilter);
      }

      if (sireFilter !== 'ALL') {
        if (sireFilter === 'OK') {
          query = query.ilike('mensaje_sire', '%registro ok%');
        } else if (sireFilter === 'DIF') {
          query = query.ilike('mensaje_sire', '%diferencia%');
        } else if (sireFilter === 'EMPTY') {
          query = query.is('mensaje_sire', null);
        }
      }

      query = query
        .order('fecha_emision', { ascending: true })
        .order('serie', { ascending: true })
        .order('correlativo', { ascending: true });

      const from = (currentPage - 1) * recordsPerPage;
      const to = from + recordsPerPage - 1;

      const { data: rows, count, error } = await query.range(from, to);

      if (error) throw error;
      return { rows: rows || [], count: count || 0 };
    },
    enabled: !!periodId,
    placeholderData: keepPreviousData,
  });

  const data = reconciliationData?.rows || [];
  const totalRecords = reconciliationData?.count || 0;
  const loading = isLoading || exportLoading;

  const getDocDescription = (code) => {
    if (code === '01') return 'Factura';
    if (code === '03') return 'Boleta';
    if (code === '07') return 'Nota de Crédito';
    if (code === '08') return 'Nota de Débito';
    if (code === '14') return 'Servicios Públicos';
    if (code === '30') return 'Adquisición de No Domiciliados';
    if (code === '42') return 'Honorario';
    return `Otro (${code})`;
  };

  // Exportar a Excel (consulta completa de registros filtrados para descarga)
  const handleExport = async () => {
    setExportLoading(true);
    try {
      let allRows = [];
      let page = 0;
      const pageSize = 2000;
      let hasMore = true;

      while (hasMore) {
        let currentQuery = supabase
          .from(activeModule === 'compras' ? 'detalle_compras' : 'detalle_ventas')
          .select('*')
          .eq('periodo_id', periodId);

        if (originFilter === 'SAP') {
          currentQuery = currentQuery.or('nro_identidad_sap.not.is.null,nombre_sap.not.is.null');
        } else if (originFilter === 'SUNAT') {
          currentQuery = currentQuery.or('nro_identidad_sunat.not.is.null,nombre_sunat.not.is.null');
        }

        if (filterSerie) {
          currentQuery = currentQuery.ilike('serie', `%${filterSerie.trim()}%`);
        }
        if (startDate) {
          currentQuery = currentQuery.gte('fecha_emision', startDate);
        }
        if (endDate) {
          currentQuery = currentQuery.lte('fecha_emision', endDate);
        }
        if (startCorr) {
          const startInt = parseInt(startCorr, 10);
          if (!isNaN(startInt)) {
            currentQuery = currentQuery.gte('correlativo_int', startInt);
          }
        }
        if (endCorr) {
          const endInt = parseInt(endCorr, 10);
          if (!isNaN(endInt)) {
            currentQuery = currentQuery.lte('correlativo_int', endInt);
          }
        }

        if (searchTerm.trim() !== '') {
          const term = `%${searchTerm.trim()}%`;
          currentQuery = currentQuery.or(`buscar_documento.ilike.${term},serie.ilike.${term},correlativo.ilike.${term},nro_identidad_sunat.ilike.${term},nro_identidad_sap.ilike.${term},nombre_sunat.ilike.${term},nombre_sap.ilike.${term}`);
        }

        if (stateFilter !== 'ALL') {
          currentQuery = currentQuery.eq('estado_validacion', stateFilter);
          if (stateFilter === 'ERROR' && subFilter !== 'ALL') {
            currentQuery = currentQuery.contains('errores_json', JSON.stringify([subFilter]));
          } else if (stateFilter === 'OBSERVADO') {
            if (subFilter !== 'ALL') {
              currentQuery = currentQuery.contains('errores_json', JSON.stringify([subFilter]));
            }
            if (filterObsIdOk === 'SAP_OK') {
              const errorString = activeModule === 'compras' ? "OBS 6: RUC PROVEEDOR INVÁLIDO (SAP)" : "OBS 6: NÚMERO DE IDENTIDAD SAP INCORRECTO";
              currentQuery = currentQuery.not('errores_json', 'cs', JSON.stringify([errorString]));
            } else if (filterObsIdOk === 'SUNAT_OK') {
              const errorString = activeModule === 'compras' ? "OBS 7: RUC PROVEEDOR INVÁLIDO (SUNAT)" : "OBS 7: NÚMERO DE IDENTIDAD SUNAT INCORRECTO";
              currentQuery = currentQuery.not('errores_json', 'cs', JSON.stringify([errorString]));
            }
          }
        }

        if (docFilter !== 'ALL') {
          currentQuery = currentQuery.eq('tipo_doc_pago', docFilter);
        }

        if (sireFilter !== 'ALL') {
          if (sireFilter === 'OK') {
            currentQuery = currentQuery.ilike('mensaje_sire', '%registro ok%');
          } else if (sireFilter === 'DIF') {
            currentQuery = currentQuery.ilike('mensaje_sire', '%diferencia%');
          } else if (sireFilter === 'EMPTY') {
            currentQuery = currentQuery.is('mensaje_sire', null);
          }
        }

        currentQuery = currentQuery
          .order('fecha_emision', { ascending: true })
          .order('serie', { ascending: true })
          .order('correlativo', { ascending: true })
          .range(page * pageSize, (page + 1) * pageSize - 1);

        const { data, error } = await currentQuery;
        if (error) throw error;

        if (!data || data.length === 0) {
          hasMore = false;
        } else {
          allRows = allRows.concat(data);
          if (data.length < pageSize) {
            hasMore = false;
          } else {
            page++;
          }
        }
      }

      if (!allRows || allRows.length === 0) return;

      const wsData = allRows.map(r => {
        const rowObj = {
          'Mensaje SIRE': r.mensaje_sire || 'Registro OK.',
          'Tipo Doc': getDocDescription(r.tipo_doc_pago),
          'Serie': r.serie,
          'Correlativo': r.correlativo,
          'Base SAP': r.base_sap,
          'Base SUNAT': r.base_sunat,
          'Diferencia Base': r.base_sap - r.base_sunat,
          'IGV SAP': r.igv_sap,
          'IGV SUNAT': r.igv_sunat,
          'Diferencia IGV': r.igv_sap - r.igv_sunat,
          'Exonerado SAP': r.exonerado_sap || 0,
          'Exonerado SUNAT': r.exonerado_sunat || 0,
          'Diferencia Exonerado': (r.exonerado_sap || 0) - (r.exonerado_sunat || 0),
          'Inafecto SAP': r.inafecto_sap || 0,
          'Inafecto SUNAT': r.inafecto_sunat || 0,
          'Diferencia Inafecto': (r.inafecto_sap || 0) - (r.inafecto_sunat || 0),
          'Servicios/Otros SAP': r.otros_sap,
          'Servicios/Otros SUNAT': r.otros_sunat,
          'Diferencia Servicios': r.otros_sap - r.otros_sunat,
          'Total SAP': r.total_sap,
          'Total SUNAT': r.total_sunat,
          'Diferencia Total': r.total_sap - r.total_sunat,
          'Estado Validación': r.estado_validacion,
          'Errores Encontrados': r.errores_json ? r.errores_json.join('; ') : ''
        };

        if (activeModule === 'compras') {
          rowObj['RUC Proveedor'] = r.ruc_proveedor || r.nro_identidad_sunat || r.nro_identidad_sap;
          rowObj['Proveedor SAP'] = r.nombre_sap;
          rowObj['Proveedor SUNAT'] = r.nombre_sunat;
        } else {
          rowObj['RUC/DNI Cliente SAP'] = r.nro_identidad_sap;
          rowObj['RUC/DNI Cliente SUNAT'] = r.nro_identidad_sunat;
          rowObj['Cliente SAP'] = r.nombre_sap;
          rowObj['Cliente SUNAT'] = r.nombre_sunat;
        }

        return rowObj;
      });

      const ws = XLSX.utils.json_to_sheet(wsData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Conciliacion');
      XLSX.writeFile(wb, `Reporte_Conciliacion_${activePeriod || 'periodo'}.xlsx`);
    } catch (e) {
      console.error("Error al exportar a Excel:", e);
    } finally {
      setExportLoading(false);
    }
  };

  const totalPages = Math.ceil(totalRecords / recordsPerPage);

  // Ventana de navegación inteligente de páginas
  const getPageNumbers = () => {
    const pages = [];
    const maxVisible = 5;
    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      let start = Math.max(2, currentPage - 1);
      let end = Math.min(totalPages - 1, currentPage + 1);
      if (currentPage <= 3) {
        end = 4;
      } else if (currentPage >= totalPages - 2) {
        start = totalPages - 3;
      }
      if (start > 2) pages.push('...');
      for (let i = start; i <= end; i++) pages.push(i);
      if (end < totalPages - 1) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div className="card-premium animate-fade-in mb-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div className="d-flex align-items-center gap-3">
          <h4 className="mb-0 fw-bold">Resultados Unificados de Conciliación</h4>
          <select
            className="form-select form-control-premium py-1 px-2"
            style={{ width: 'auto', fontSize: '0.85rem' }}
            value={recordsPerPage}
            onChange={(e) => { setRecordsPerPage(parseInt(e.target.value, 10)); setCurrentPage(1); }}
          >
            <option value={20}>Mostrar 20 filas</option>
            <option value={50}>Mostrar 50 filas</option>
            <option value={100}>Mostrar 100 filas</option>
          </select>
        </div>
        <button
          onClick={handleExport}
          disabled={totalRecords === 0}
          className="btn btn-outline-primary d-flex align-items-center px-3 py-2 rounded-3"
          style={{ cursor: 'pointer' }}
        >
          <FiDownload className="me-2" /> Exportar a Excel
        </button>
      </div>

      {/* Grid de Filtros */}
      <div className="row g-2 mb-4">
        <div className="col-lg-3">
          <div className="input-group">
            <span className="input-group-text border-0 bg-dark text-muted"><FiSearch /></span>
            <input
              type="text"
              className="form-control form-control-premium"
              placeholder="Buscar folio, RUC/DNI, nombre..."
              value={searchInputValue}
              onChange={(e) => setSearchInputValue(e.target.value)}
            />
          </div>
        </div>

        <div className="col-lg-3">
          <select 
            className="form-select form-control-premium"
            value={stateFilter}
            onChange={(e) => handleStateFilterChange(e.target.value)}
          >
            <option value="ALL">Todos los Estados (OK / Error / Obs.)</option>
            <option value="OK">Correcto (OK)</option>
            <option value="ERROR">Error</option>
            <option value="OBSERVADO">Observado</option>
          </select>
        </div>

        <div className="col-lg-2">
          <select
            className="form-select form-control-premium"
            value={docFilter}
            onChange={(e) => { setDocFilter(e.target.value); setCurrentPage(1); }}
          >
            <option value="ALL">Todos los Docs</option>
            <option value="01">Facturas</option>
            <option value="03">Boletas</option>
            <option value="07">N. Crédito</option>
            <option value="08">N. Débito</option>
          </select>
        </div>

        <div className="col-lg-2">
          <select
            className="form-select form-control-premium"
            value={sireFilter}
            onChange={(e) => { setSireFilter(e.target.value); setCurrentPage(1); }}
          >
            <option value="ALL">SIRE: Todos</option>
            <option value="OK">Registro OK</option>
            <option value="DIF">Diferencias</option>
            <option value="EMPTY">Sin Mensaje</option>
          </select>
        </div>

        {/* Filtro Dinámico por Grupo de Errores y Observaciones */}
        {stateFilter === 'ERROR' && (
          <div className="col-lg-2 animate-fade-in">
            <select
              className="form-select form-control-premium"
              value={subFilter}
              onChange={(e) => { setSubFilter(e.target.value); setCurrentPage(1); }}
            >
              <option value="ALL">Todos los Errores</option>
              {visibleErrors.map(err => (
                <option key={err.value} value={err.value}>
                  {err.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {stateFilter === 'OBSERVADO' && (
          <div className="col-lg-2 animate-fade-in">
            <select
              className="form-select form-control-premium"
              value={subFilter}
              onChange={(e) => { setSubFilter(e.target.value); setCurrentPage(1); }}
            >
              <option value="ALL">Todas las Obs.</option>
              {visibleObservations.map(obs => (
                <option key={obs.value} value={obs.value}>
                  {obs.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {stateFilter !== 'ERROR' && stateFilter !== 'OBSERVADO' && (
          <div className="col-lg-2 animate-fade-in">
            <select
              className="form-select form-control-premium"
              value={originFilter}
              onChange={(e) => { setOriginFilter(e.target.value); setFilterObsIdOk('ALL'); setCurrentPage(1); }}
            >
              <option value="ALL">Origen: Todos</option>
              <option value="SAP">Solo SAP</option>
              <option value="SUNAT">Solo SUNAT</option>
            </select>
          </div>
        )}
      </div>

      {/* Segunda Fila de Filtros (Rango de Fechas, Serie y Correlativos) */}
      <div className="row g-2 mb-4 animate-fade-in">
        <div className="col-lg-2">
          <div className="input-group">
            <span className="input-group-text border-0 bg-dark text-muted" style={{ fontSize: '0.85rem' }}>Serie</span>
            <input
              type="text"
              className="form-control form-control-premium"
              placeholder="Ej. B807"
              value={filterSerie}
              onChange={(e) => { setFilterSerie(e.target.value); setCurrentPage(1); }}
            />
          </div>
        </div>
        <div className="col-lg-2">
          <div className="input-group">
            <span className="input-group-text border-0 bg-dark text-muted" style={{ fontSize: '0.85rem' }}>Corr. Desde</span>
            <input
              type="text"
              className="form-control form-control-premium"
              placeholder="Ej. 1"
              value={startCorr}
              onChange={(e) => { setStartCorr(e.target.value); setCurrentPage(1); }}
            />
          </div>
        </div>
        <div className="col-lg-2">
          <div className="input-group">
            <span className="input-group-text border-0 bg-dark text-muted" style={{ fontSize: '0.85rem' }}>Corr. Hasta</span>
            <input
              type="text"
              className="form-control form-control-premium"
              placeholder="Ej. 9999"
              value={endCorr}
              onChange={(e) => { setEndCorr(e.target.value); setCurrentPage(1); }}
            />
          </div>
        </div>
        <div className="col-lg-2">
          <div className="input-group">
            <span className="input-group-text border-0 bg-dark text-muted" style={{ fontSize: '0.85rem' }}>Fecha Desde</span>
            <input
              type="date"
              className="form-control form-control-premium"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setCurrentPage(1); }}
            />
          </div>
        </div>
        <div className="col-lg-2">
          <div className="input-group">
            <span className="input-group-text border-0 bg-dark text-muted" style={{ fontSize: '0.85rem' }}>Fecha Hasta</span>
            <input
              type="date"
              className="form-control form-control-premium"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setCurrentPage(1); }}
            />
          </div>
        </div>
        <div className="col-lg-2">
          <button
            className="btn btn-outline-secondary w-100 h-100 d-flex align-items-center justify-content-center py-2 rounded-3"
            onClick={handleClearAdvancedFilters}
            style={{ fontSize: '0.85rem', cursor: 'pointer' }}
            disabled={!startDate && !endDate && !filterSerie && !startCorr && !endCorr && originFilter === 'ALL'}
          >
            Limpiar Filtros
          </button>
        </div>
      </div>

      {/* Alerta del filtro de consistencia de identidad */}
      {filterObsIdOk !== 'ALL' && (
        <div className="alert alert-info py-2 px-3 mb-3 border-0 rounded-3 d-flex align-items-center justify-content-between text-white bg-info bg-opacity-10 animate-fade-in" style={{ fontSize: '0.85rem' }}>
          <div>
            <FiCheckCircle className="me-2 text-info fs-5" />
            Mostrando comprobantes <strong>Observados</strong> con <strong>Número de Identidad {filterObsIdOk === 'SAP_OK' ? 'SAP' : 'SUNAT'} Correcto</strong>.
          </div>
          <button 
            className="btn btn-sm btn-link text-info p-0" 
            onClick={() => setFilterObsIdOk('ALL')}
            style={{ textDecoration: 'none', cursor: 'pointer' }}
          >
            Quitar Filtro
          </button>
        </div>
      )}

      {/* Tabla Unificada */}
      {loading ? (
        <div className="text-center py-5">
          <div className="spinner-border text-primary" role="status"></div>
          <p className="text-muted mt-2">Cargando registros conciliados...</p>
        </div>
      ) : totalRecords === 0 ? (
        <div className="text-center py-5 bg-dark rounded-3 bg-opacity-25">
          <FiAlertCircle className="text-muted fs-1 mb-2" />
          <p className="text-muted mb-0">No se encontraron registros que coincidan con la búsqueda.</p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-dark table-borderless table-dense align-middle text-nowrap">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th>FOLIO (SERIE-NRO)</th>
                <th>FECHA EMIS.</th>
                <th>TIPO DOC</th>
                <th>IDENTIDAD {activeModule === 'compras' ? 'PROV' : 'SUNAT'}</th>
                <th>{activeModule === 'compras' ? 'PROVEEDOR' : 'CLIENTE SUNAT'}</th>
                <th className="text-end">BASE SAP</th>
                <th className="text-end">BASE SUNAT</th>
                <th className="text-end">IGV SAP</th>
                <th className="text-end">IGV SUNAT</th>
                <th className="text-end">TOTAL SAP</th>
                <th className="text-end">TOTAL SUNAT</th>
                <th>SIRE LOG</th>
                <th className="text-center">ESTADO</th>
                <th className="text-center">LOG</th>
              </tr>
            </thead>
            <tbody>
              {data.map(r => {
                const diffBase = Math.abs(r.base_sap - r.base_sunat) > 0.05;
                const diffIgv = Math.abs(r.igv_sap - r.igv_sunat) > 0.05;
                const diffTotal = Math.abs(r.total_sap - r.total_sunat) > 0.05;

                return (
                  <tr key={r.id}>
                    <td className="fw-semibold font-mono">{r.serie}-{r.correlativo}</td>
                    <td className="font-mono">{r.fecha_emision || 'N/A'}</td>
                    <td>{getDocDescription(r.tipo_doc_pago)}</td>
                    <td className="font-mono">
                      {activeModule === 'compras'
                        ? (r.ruc_proveedor || r.nro_identidad_sunat || r.nro_identidad_sap || 'No Registrado')
                        : (r.nro_identidad_sunat || 'No Registrado')
                      }
                    </td>
                    <td className="text-truncate" style={{ maxWidth: '150px' }} title={r.nombre_sunat || r.nombre_sap}>
                      {activeModule === 'compras'
                        ? (r.nombre_sunat || r.nombre_sap || '(Falta en SUNAT)')
                        : (r.nombre_sunat || '(Falta en SUNAT)')
                      }
                    </td>
                    
                    {/* Montos */}
                    <td className="text-end font-mono">{r.base_sap.toFixed(2)}</td>
                    <td className={`text-end font-mono ${diffBase ? 'cell-mismatch' : 'cell-match'}`}>
                      {r.base_sunat.toFixed(2)}
                    </td>
                    
                    <td className="text-end font-mono">{r.igv_sap.toFixed(2)}</td>
                    <td className={`text-end font-mono ${diffIgv ? 'cell-mismatch' : 'cell-match'}`}>
                      {r.igv_sunat.toFixed(2)}
                    </td>
                    
                    <td className="text-end font-mono">{r.total_sap.toFixed(2)}</td>
                    <td className={`text-end font-mono ${diffTotal ? 'cell-mismatch' : 'cell-match'}`}>
                      {r.total_sunat.toFixed(2)}
                    </td>

                    {/* Mensaje SIRE */}
                    <td className="text-truncate" style={{ maxWidth: '180px' }} title={r.mensaje_sire}>
                      {r.mensaje_sire || <span className="text-muted font-mono">(Registro Huérfano)</span>}
                    </td>

                    {/* Badge Estado */}
                    <td className="text-center">
                      <span className={`badge badge-status badge-status-${r.estado_validacion.toLowerCase()}`}>
                        {r.estado_validacion}
                      </span>
                    </td>

                    {/* Ver Errores */}
                    <td className="text-center">
                      <button
                        onClick={() => setSelectedRow(r)}
                        className="btn btn-sm btn-outline-secondary p-1 border-0"
                        style={{ cursor: 'pointer' }}
                        title="Ver detalle de auditoría"
                      >
                        <FiEye />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="d-flex justify-content-between align-items-center mt-3 pt-3" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="text-muted" style={{ fontSize: '0.85rem' }}>
            Mostrando {((currentPage - 1) * recordsPerPage) + 1} - {Math.min(currentPage * recordsPerPage, totalRecords)} de {totalRecords} registros.
          </span>
          <nav>
            <ul className="pagination pagination-premium mb-0">
              <li className={`page-item ${currentPage === 1 ? 'disabled' : ''}`}>
                <button className="page-link" onClick={() => setCurrentPage(currentPage - 1)}>
                  Anterior
                </button>
              </li>
              {getPageNumbers().map((num, i) => {
                if (num === '...') {
                  return (
                    <li key={`ellipsis-${i}`} className="page-item-ellipsis d-flex align-items-center justify-content-center">
                      ...
                    </li>
                  );
                }
                return (
                  <li key={`page-${num}`} className={`page-item ${currentPage === num ? 'active' : ''}`}>
                    <button 
                      className="page-link" 
                      onClick={() => setCurrentPage(num)}
                    >
                      {num}
                    </button>
                  </li>
                );
              })}
              <li className={`page-item ${currentPage === totalPages ? 'disabled' : ''}`}>
                <button className="page-link" onClick={() => setCurrentPage(currentPage + 1)}>
                  Siguiente
                </button>
              </li>
            </ul>
          </nav>
        </div>
      )}

      {/* Modal Detalle Errores */}
      {selectedRow && createPortal(
        <div 
          className="modal fade show d-block" 
          tabIndex="-1" 
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.65)' }}
        >
          <div className="modal-dialog modal-dialog-centered modal-xl">
            <div 
              className="modal-content rounded-3 p-5" 
              style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', minHeight: '450px' }}
            >
              <div className="modal-header border-0 pb-0 d-flex justify-content-between align-items-center">
                <h3 className="modal-title fw-bold text-dark" style={{ fontSize: '2rem' }}>
                  Auditoría Folio: {selectedRow.serie}-{selectedRow.correlativo}
                </h3>
                <button 
                  type="button" 
                  className="border-0 bg-transparent fs-2 text-muted p-0 d-flex align-items-center justify-content-center" 
                  onClick={() => setSelectedRow(null)}
                  style={{ cursor: 'pointer' }}
                >
                  <FiX />
                </button>
              </div>
              <div className="modal-body py-4">
                <div className="mb-4">
                  <div className="text-muted fw-bold mb-1" style={{ fontSize: '1rem', letterSpacing: '0.05em' }}>TIPO COMPROBANTE</div>
                  <div className="fw-bold text-dark" style={{ fontSize: '1.3rem' }}>{getDocDescription(selectedRow.tipo_doc_pago)}</div>
                </div>

                <div className="row g-4 mb-4">
                  <div className="col-6">
                    <div className="text-muted fw-bold mb-1" style={{ fontSize: '1rem', letterSpacing: '0.05em' }}>IDENTIDAD SAP</div>
                    <div className="font-mono fw-bold text-dark" style={{ fontSize: '1.25rem' }}>{selectedRow.nro_identidad_sap || 'N/A'} <span className="text-muted fw-normal" style={{ fontSize: '1.05rem' }}>(Tipo: {selectedRow.tipo_identidad_sap || 'N/A'})</span></div>
                  </div>
                  <div className="col-6">
                    <div className="text-muted fw-bold mb-1" style={{ fontSize: '1rem', letterSpacing: '0.05em' }}>IDENTIDAD SUNAT</div>
                    <div className="font-mono fw-bold text-dark" style={{ fontSize: '1.25rem' }}>{selectedRow.nro_identidad_sunat || 'N/A'} <span className="text-muted fw-normal" style={{ fontSize: '1.05rem' }}>(Tipo: {selectedRow.tipo_identidad_sunat || 'N/A'})</span></div>
                  </div>
                </div>

                <div className="row g-4 mb-4">
                  <div className="col-6">
                    <div className="text-muted fw-bold mb-1" style={{ fontSize: '1rem', letterSpacing: '0.05em' }}>NOMBRE SAP</div>
                    <div className="fw-bold text-dark" style={{ fontSize: '1.3rem' }}>{selectedRow.nombre_sap || 'N/A'}</div>
                  </div>
                  <div className="col-6">
                    <div className="text-muted fw-bold mb-1" style={{ fontSize: '1rem', letterSpacing: '0.05em' }}>NOMBRE SUNAT</div>
                    <div className="fw-bold text-dark" style={{ fontSize: '1.3rem' }}>{selectedRow.nombre_sunat || 'N/A'}</div>
                  </div>
                </div>

                <div className="mb-4">
                  <div className="text-muted fw-bold mb-1" style={{ fontSize: '1rem', letterSpacing: '0.05em' }}>LOG SIRE MENSAJE</div>
                  <div className="fst-italic text-dark fw-semibold" style={{ fontSize: '1.2rem' }}>{selectedRow.mensaje_sire || 'No registrado'}</div>
                </div>

                <div className="border-top pt-4" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="d-flex align-items-center mb-3">
                    <FiAlertCircle className={`me-2 fs-3 ${selectedRow.estado_validacion === 'OK' ? 'text-success' : selectedRow.estado_validacion === 'ERROR' ? 'text-danger' : 'text-warning'}`} />
                    <span className="fw-bold text-dark" style={{ fontSize: '1.3rem' }}>Reglas Infraccionadas ({selectedRow.errores_json?.length || 0})</span>
                  </div>
                  
                  {selectedRow.errores_json && selectedRow.errores_json.length > 0 ? (
                    <ul className="ps-4 mb-0" style={{ fontSize: '1.2rem', lineHeight: '1.6' }}>
                      {selectedRow.errores_json.map((err, idx) => (
                        <li key={idx} className="text-warning mb-2 fw-semibold">{err}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-success mb-0 fw-semibold" style={{ fontSize: '1.2rem' }}>✓ Todos los cruces de identidad, importes, secuencias y SIRE coinciden perfectamente.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
