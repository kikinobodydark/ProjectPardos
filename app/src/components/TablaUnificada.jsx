import React, { useState, useEffect } from 'react';
import { supabase } from '../utils/supabaseClient';
import { FiDownload, FiSearch, FiSliders, FiEye, FiCheck, FiX, FiAlertCircle } from 'react-icons/fi';
import * as XLSX from 'xlsx';

export default function TablaUnificada({ periodId, activePeriod }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState([]);
  const [totalRecords, setTotalRecords] = useState(0);

  // Filtros
  const [searchInputValue, setSearchInputValue] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [stateFilter, setStateFilter] = useState('ALL');
  const [docFilter, setDocFilter] = useState('ALL');
  const [sireFilter, setSireFilter] = useState('ALL');

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

  useEffect(() => {
    if (periodId) {
      fetchData();
    }
  }, [periodId, currentPage, searchTerm, stateFilter, docFilter, sireFilter, recordsPerPage]);

  const fetchData = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('detalle_validacion')
        .select('*', { count: 'exact' })
        .eq('periodo_id', periodId);

      // Filtros del lado de la base de datos (Lazy Loading)
      if (searchTerm.trim() !== '') {
        const term = `%${searchTerm.trim()}%`;
        query = query.or(`serie.ilike.${term},correlativo.ilike.${term},nro_identidad_sunat.ilike.${term},nro_identidad_sap.ilike.${term},nombre_sunat.ilike.${term},nombre_sap.ilike.${term}`);
      }

      if (stateFilter !== 'ALL') {
        query = query.eq('estado_validacion', stateFilter);
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

      // Ordenamiento
      query = query
        .order('fecha_emision', { ascending: true })
        .order('serie', { ascending: true })
        .order('correlativo', { ascending: true });

      // Límites de la página activa
      const from = (currentPage - 1) * recordsPerPage;
      const to = from + recordsPerPage - 1;

      const { data: rows, count, error } = await query.range(from, to);

      if (error) throw error;
      setData(rows || []);
      setTotalRecords(count || 0);
    } catch (e) {
      console.error("Error al obtener detalle de conciliación:", e);
    } finally {
      setLoading(false);
    }
  };

  const getDocDescription = (code) => {
    if (code === '01') return 'Factura';
    if (code === '03') return 'Boleta';
    if (code === '07') return 'Nota de Crédito';
    if (code === '08') return 'Nota de Débito';
    return `Otro (${code})`;
  };

  // Exportar a Excel (consulta completa de registros filtrados para descarga)
  const handleExport = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('detalle_validacion')
        .select('*')
        .eq('periodo_id', periodId);

      if (searchTerm.trim() !== '') {
        const term = `%${searchTerm.trim()}%`;
        query = query.or(`serie.ilike.${term},correlativo.ilike.${term},nro_identidad_sunat.ilike.${term},nro_identidad_sap.ilike.${term},nombre_sunat.ilike.${term},nombre_sap.ilike.${term}`);
      }

      if (stateFilter !== 'ALL') {
        query = query.eq('estado_validacion', stateFilter);
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

      const { data: allRows, error } = await query;
      if (error) throw error;

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
      setLoading(false);
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
        <h4 className="text-white mb-0 fw-bold">Resultados Unificados de Conciliación</h4>
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
            onChange={(e) => { setStateFilter(e.target.value); setCurrentPage(1); }}
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

        <div className="col-lg-2">
          <select
            className="form-select form-control-premium"
            value={recordsPerPage}
            onChange={(e) => { setRecordsPerPage(parseInt(e.target.value, 10)); setCurrentPage(1); }}
          >
            <option value={20}>Mostrar 20 filas</option>
            <option value={50}>Mostrar 50 filas</option>
            <option value={100}>Mostrar 100 filas</option>
          </select>
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
                    <td className="fw-semibold text-white font-mono">{r.serie}-{r.correlativo}</td>
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
      {selectedRow && (
        <div 
          className="modal fade show d-block" 
          tabIndex="-1" 
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.65)' }}
        >
          <div className="modal-dialog modal-dialog-centered">
            <div 
              className="modal-content text-white rounded-3 p-2" 
              style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}
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
        </div>
      )}
    </div>
  );
}
