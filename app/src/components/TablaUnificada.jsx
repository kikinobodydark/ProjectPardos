import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '../utils/supabaseClient';
import { FiDownload, FiSearch, FiEye, FiX, FiAlertCircle } from 'react-icons/fi';
import * as XLSX from 'xlsx';

export default function TablaUnificada({ periodId, activePeriod, initialFilter, onFilterReset }) {
  const [exportLoading, setExportLoading] = useState(false);

  // Filtros
  const [searchInputValue, setSearchInputValue] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [stateFilter, setStateFilter] = useState('ALL');
  const [subFilter, setSubFilter] = useState('ALL');
  const [docFilter, setDocFilter] = useState('ALL');
  const [sireFilter, setSireFilter] = useState('ALL');

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
    setCurrentPage(1);
  };

  // Control sincrónico de cambio de filtros para evitar race conditions
  const handleStateFilterChange = (newVal) => {
    setSubFilter('ALL');
    setStateFilter(newVal);
    setCurrentPage(1);
  };

  // Si hay un filtro inicial del dashboard, aplicarlo
  useEffect(() => {
    if (initialFilter) {
      if (initialFilter === 'SAP_OK') {
        setStateFilter('OK');
        setOriginFilter('SAP');
        setSubFilter('ALL');
      } else if (initialFilter === 'SUNAT_OK') {
        setStateFilter('OK');
        setOriginFilter('SUNAT');
        setSubFilter('ALL');
      } else {
        setOriginFilter('ALL');
        setStateFilter(initialFilter);
        setSubFilter('ALL');
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
    queryKey: ['reconciliation', periodId, currentPage, searchTerm, stateFilter, subFilter, docFilter, sireFilter, recordsPerPage, startDate, endDate, filterSerie, startCorr, endCorr, originFilter],
    queryFn: async () => {
      let query = supabase
        .from('detalle_validacion')
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
        } else if (stateFilter === 'OBSERVADO' && subFilter !== 'ALL') {
          query = query.contains('errores_json', JSON.stringify([subFilter]));
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
          .from('detalle_validacion')
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
          } else if (stateFilter === 'OBSERVADO' && subFilter !== 'ALL') {
            currentQuery = currentQuery.contains('errores_json', JSON.stringify([subFilter]));
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

      const wsData = allRows.map(r => ({
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
        'Servicios/Otros SAP': r.otros_sap,
        'Servicios/Otros SUNAT': r.otros_sunat,
        'Diferencia Servicios': r.otros_sap - r.otros_sunat,
        'Total SAP': r.total_sap,
        'Total SUNAT': r.total_sunat,
        'Diferencia Total': r.total_sap - r.total_sunat,
        'Estado Validación': r.estado_validacion,
        'Errores Encontrados': r.errores_json ? r.errores_json.join('; ') : ''
      }));

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
              <option value="ERROR 1: DIFERENCIA EN LA BI Gravada">ERROR 1: DIFERENCIA EN BI Gravada</option>
              <option value="ERROR 2: DIFERENCIA EN EL IGV / IPM">ERROR 2: DIFERENCIA EN IGV / IPM</option>
              <option value="ERROR 3: DIFERENCIA EN Mto Exonerado">ERROR 3: DIFERENCIA EN Mto Exonerado</option>
              <option value="ERROR 4: DIFERENCIA EN Mto Inafecto">ERROR 4: DIFERENCIA EN Mto Inafecto</option>
              <option value="ERROR 5: DIFERENCIA EN TOTALES">ERROR 5: DIFERENCIA EN TOTALES</option>
              <option value="ERROR 6: BOLETAS MAYOR A 700 SOLES SIN DNI">ERROR 6: BOLETAS &gt; 700 SIN DNI</option>
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
              <option value="OBS 1: DIFERENCIA EN TIPO DE IDENTIDAD">OBS 1: DIFERENCIA TIPO IDENTIDAD</option>
              <option value="OBS 2: DIFERENCIA EN NUMERO DE IDENTIDAD">OBS 2: DIFERENCIA NUMERO IDENTIDAD</option>
              <option value="OBS 3: DIFERENCIA EN SECUENCIA DE CORRELATIVOS">OBS 3: DIFERENCIA SECUENCIA</option>
              <option value="OBS 4: NO EXISTE EN SAP">OBS 4: NO EXISTE EN SAP</option>
              <option value="OBS 5: NO EXISTE EN SUNAT">OBS 5: NO EXISTE EN SUNAT</option>
            </select>
          </div>
        )}

        {stateFilter !== 'ERROR' && stateFilter !== 'OBSERVADO' && (
          <div className="col-lg-2 animate-fade-in">
            <select
              className="form-select form-control-premium"
              value={originFilter}
              onChange={(e) => { setOriginFilter(e.target.value); setCurrentPage(1); }}
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
                <th>IDENTIDAD SUNAT</th>
                <th>CLIENTE SUNAT</th>
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
                    <td className="font-mono">{r.nro_identidad_sunat || 'No Registrado'}</td>
                    <td className="text-truncate" style={{ maxWidth: '150px' }} title={r.nombre_sunat}>{r.nombre_sunat || '(Falta en SUNAT)'}</td>
                    
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
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div 
              className="modal-content rounded-3 p-4" 
              style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', minHeight: '400px' }}
            >
              <div className="modal-header border-0 pb-0 d-flex justify-content-between align-items-center">
                <h5 className="modal-title fw-bold">
                  Auditoría Folio: {selectedRow.serie}-{selectedRow.correlativo}
                </h5>
                <button 
                  type="button" 
                  className="border-0 bg-transparent fs-4 text-muted p-0 d-flex align-items-center justify-content-center" 
                  onClick={() => setSelectedRow(null)}
                  style={{ cursor: 'pointer' }}
                >
                  <FiX />
                </button>
              </div>
              <div className="modal-body py-3">
                <div className="mb-3">
                  <div className="text-muted" style={{ fontSize: '0.8rem' }}>TIPO COMPROBANTE</div>
                  <div className="fw-semibold">{getDocDescription(selectedRow.tipo_doc_pago)}</div>
                </div>

                <div className="row g-2 mb-3">
                  <div className="col-6">
                    <div className="text-muted" style={{ fontSize: '0.8rem' }}>IDENTIDAD SAP</div>
                    <div className="font-mono">{selectedRow.nro_identidad_sap || 'N/A'} (Tipo: {selectedRow.tipo_identidad_sap || 'N/A'})</div>
                  </div>
                  <div className="col-6">
                    <div className="text-muted" style={{ fontSize: '0.8rem' }}>IDENTIDAD SUNAT</div>
                    <div className="font-mono">{selectedRow.nro_identidad_sunat || 'N/A'} (Tipo: {selectedRow.tipo_identidad_sunat || 'N/A'})</div>
                  </div>
                </div>

                <div className="mb-3">
                  <div className="text-muted" style={{ fontSize: '0.8rem' }}>LOG SIRE MENSAJE</div>
                  <div className="fst-italic">{selectedRow.mensaje_sire || 'No registrado'}</div>
                </div>

                <div className="border-top pt-3" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="d-flex align-items-center mb-2">
                    <FiAlertCircle className={`me-2 ${selectedRow.estado_validacion === 'OK' ? 'text-success' : selectedRow.estado_validacion === 'ERROR' ? 'text-danger' : 'text-warning'}`} />
                    <span className="fw-bold">Reglas Infraccionadas ({selectedRow.errores_json?.length || 0})</span>
                  </div>
                  
                  {selectedRow.errores_json && selectedRow.errores_json.length > 0 ? (
                    <ul className="ps-3 mb-0" style={{ fontSize: '0.85rem' }}>
                      {selectedRow.errores_json.map((err, idx) => (
                        <li key={idx} className="text-warning mb-1">{err}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-success mb-0" style={{ fontSize: '0.85rem' }}>✓ Todos los cruces de identidad, importes, secuencias y SIRE coinciden perfectamente.</p>
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
