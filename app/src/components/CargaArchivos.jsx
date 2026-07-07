import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../utils/supabaseClient';
import { parseSAP, parseSUNAT, parseSIRE, stripBOM, parseSAPCompras, parseSUNATCompras } from '../utils/parsers';
import { reconcileData } from '../utils/validations';
import { FiUpload, FiFileText, FiCheck, FiPlay, FiAlertTriangle } from 'react-icons/fi';
import * as XLSX from 'xlsx';

export default function CargaArchivos({ activeCompany, userProfile, onProcessComplete, activeModule }) {
  const [periodo, setPeriodo] = useState(''); // Formato YYYYMM, ej. 202606
  const [dia, setDia] = useState('');
  const [version, setVersion] = useState('1');
  const [sapFile, setSapFile] = useState(null);
  const [sunatFile, setSunatFile] = useState(null);
  const [sireFile, setSireFile] = useState(null);
  const [cortesiasFile, setCortesiasFile] = useState(null);
  
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [recentLoads, setRecentLoads] = useState([]);
  const [showPeriodSuggestions, setShowPeriodSuggestions] = useState(false);
  const [showDiaSuggestions, setShowDiaSuggestions] = useState(false);
  const [showVersionSuggestions, setShowVersionSuggestions] = useState(false);

  const fetchRecentLoads = useCallback(async () => {
    if (!activeCompany?.id) return;
    try {
      const { data, error } = await supabase
        .from('periodos_carga')
        .select('periodo, dia, version, fecha_carga')
        .eq('empresa_id', activeCompany.id)
        .eq('modulo', activeModule)
        .eq('estado', 'completado')
        .order('fecha_carga', { ascending: false })
        .limit(10);
      
      if (!error && data) {
        setRecentLoads(data);
      }
    } catch (err) {
      console.error('Error fetching recent loads:', err);
    }
  }, [activeCompany?.id, activeModule]);

  useEffect(() => {
    fetchRecentLoads();
  }, [fetchRecentLoads]);

  const handleFileChange = (e, type) => {
    const file = e.target.files[0];
    if (file) {
      if (type === 'sap') setSapFile(file);
      if (type === 'sunat') setSunatFile(file);
      if (type === 'sire') setSireFile(file);
      if (type === 'cortesias') setCortesiasFile(file);
    }
  };

  // Leer archivo con codificación específica
  const readFileAsText = (file, encoding = 'utf-8') => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const buffer = event.target.result;
        const decoder = new TextDecoder(encoding);
        const text = decoder.decode(buffer);
        resolve(text);
      };
      reader.onerror = (err) => reject(err);
      reader.readAsArrayBuffer(file);
    });
  };

  // Leer archivo Excel (.xlsx) y devolver objetos JSON
  const readExcelFile = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const json = XLSX.utils.sheet_to_json(sheet);
          resolve(json);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsArrayBuffer(file);
    });
  };

  const handleProcess = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    
    if (!sapFile || !sunatFile || !sireFile) {
      setErrorMsg('Debes seleccionar los 3 archivos obligatorios (SAP, SUNAT y SIRE).');
      return;
    }

    if (periodo.length !== 6 || !/^\d+$/.test(periodo)) {
      setErrorMsg('El período debe ser de 6 dígitos numéricos (AAAAMM).');
      return;
    }

    // Validación contextual del día del mes
    const year = parseInt(periodo.slice(0, 4), 10);
    const month = parseInt(periodo.slice(4, 6), 10);
    const maxDia = new Date(year, month, 0).getDate();
    const diaNum = parseInt(dia, 10);
    if (isNaN(diaNum) || diaNum < 1 || diaNum > maxDia) {
      setErrorMsg(`El día debe estar entre 1 y ${maxDia} para el período ${periodo.slice(0, 4)}-${periodo.slice(4)}.`);
      return;
    }

    // Validación de versión
    const versionNum = parseInt(version, 10);
    if (isNaN(versionNum) || versionNum < 1) {
      setErrorMsg('La versión debe ser un número entero positivo.');
      return;
    }

    setLoading(true);
    setStatusText('Leyendo y decodificando archivos...');

    try {
      // 1. Leer archivos con su codificación respectiva
      // SUNAT: UTF-8 (con BOM)
      // SAP y SIRE: Windows-1252 / Latin-1
      const sunatTextRaw = await readFileAsText(sunatFile, 'utf-8');
      const sunatText = stripBOM(sunatTextRaw);

      const sapText = await readFileAsText(sapFile, 'windows-1252');
      const sireText = await readFileAsText(sireFile, 'windows-1252');

      let cortesiasData = [];
      if (cortesiasFile) {
        setStatusText('Parseando archivo de cortesías (Excel)...');
        cortesiasData = await readExcelFile(cortesiasFile);
      }

      setStatusText('Parseando registros...');
      const sunatData = activeModule === 'compras' ? parseSUNATCompras(sunatText) : parseSUNAT(sunatText);
      const sapData = activeModule === 'compras' ? parseSAPCompras(sapText) : parseSAP(sapText);
      const sireData = parseSIRE(sireText);

      if (sunatData.length === 0) throw new Error('El archivo de SUNAT está vacío o no coincide con el formato.');
      if (sapData.length === 0) throw new Error('El archivo de SAP está vacío o no coincide con el formato.');
      if (sireData.length === 0) throw new Error('El archivo de SIRE está vacío o no coincide con el formato.');

      setStatusText('Conciliando y aplicando reglas tributarias...');
      const reconciledList = reconcileData(sapData, sunatData, sireData, activeCompany.ruc, cortesiasData, activeModule);

      setStatusText(`Preparando ${reconciledList.length} registros para base de datos...`);

      // 2. Crear período de carga en Supabase
      const { data: periodData, error: periodErr } = await supabase
        .from('periodos_carga')
        .insert({
          empresa_id: activeCompany.id,
          usuario_id: userProfile.id,
          periodo: periodo,
          dia: dia,
          version: versionNum,
          estado: 'procesando',
          modulo: activeModule
        })
        .select()
        .single();

      if (periodErr) throw periodErr;
      const periodId = periodData.id;

      // 3. Subir en bloques de 1000 para evitar sobrecarga o límites del query
      setStatusText('Cargando registros unificados a Supabase...');
      const chunkSize = 1000;
      for (let i = 0; i < reconciledList.length; i += chunkSize) {
        const chunk = reconciledList.slice(i, i + chunkSize).map(r => {
          const itemObj = {
            periodo_id: periodId,
            empresa_id: activeCompany.id,
            car_sunat: r.car_sunat,
            serie: r.serie,
            correlativo: r.correlativo,
            fecha_emision: r.fecha_emision,
            tipo_doc_pago: r.tipo_doc_pago,
            
            tipo_identidad_sap: r.tipo_identidad_sap,
            nro_identidad_sap: r.nro_identidad_sap,
            nombre_sap: r.nombre_sap,
            base_sap: r.base_sap,
            igv_sap: r.igv_sap,
            exonerado_sap: r.exonerado_sap || 0,
            inafecto_sap: r.inafecto_sap || 0,
            otros_sap: r.otros_sap,
            total_sap: r.total_sap,
            
            tipo_identidad_sunat: r.tipo_identidad_sunat,
            nro_identidad_sunat: r.nro_identidad_sunat,
            nombre_sunat: r.nombre_sunat,
            base_sunat: r.base_sunat,
            igv_sunat: r.igv_sunat,
            exonerado_sunat: r.exonerado_sunat || 0,
            inafecto_sunat: r.inafecto_sunat || 0,
            otros_sunat: r.otros_sunat,
            total_sunat: r.total_sunat,
            
            mensaje_sire: r.mensaje_sire,
            estado_validacion: r.estado_validacion,
            errores_json: r.errores_json
          };

          if (activeModule === 'compras') {
            itemObj.ruc_proveedor = r.ruc_proveedor;
          } else {
            itemObj.tipo_pago_sire = r.tipo_pago_sire;
            itemObj.op_gratuitas = r.op_gratuitas;
          }

          return itemObj;
        });

        const { error: insertErr } = await supabase
          .from(activeModule === 'compras' ? 'detalle_compras' : 'detalle_ventas')
          .insert(chunk);

        if (insertErr) {
          // Si falla, actualizar estado del período a error
          await supabase
            .from('periodos_carga')
            .update({ estado: 'error' })
            .eq('id', periodId);
          throw insertErr;
        }
      }

      // 4. Completar período de carga
      await supabase
        .from('periodos_carga')
        .update({ estado: 'completado' })
        .eq('id', periodId);

      // Recargar histórico de cargas recientes
      fetchRecentLoads();

      setSuccessMsg(`¡Proceso exitoso! Se cargaron y conciliaron ${reconciledList.length} registros del período ${periodo}.`);
      
      // Limpiar inputs
      setSapFile(null);
      setSunatFile(null);
      setSireFile(null);
      setCortesiasFile(null);
      setDia('');
      setVersion('1');
      document.getElementById('form-carga').reset();

      // Notificar al componente principal con formato extendido
      onProcessComplete(periodId, `${periodo} (Día: ${dia}, v${versionNum})`);

    } catch (e) {
      console.error(e);
      setErrorMsg(e.message || 'Ocurrió un error inesperado al procesar y guardar la conciliación.');
    } finally {
      setLoading(false);
      setStatusText('');
    }
  };

  return (
    <div className="card-premium animate-fade-in">
      <h4 className="mb-3 fw-bold">Nueva Carga de Reportes Mensuales</h4>
      <p className="text-muted" style={{ fontSize: '0.88rem' }}>
        Sube los tres reportes TXT de SAP, SUNAT y el log del SIRE correspondientes al mismo período contable.
      </p>

      {errorMsg && (
        <div className="alert alert-danger d-flex align-items-center py-2 px-3 mb-4 border-0 rounded-3" style={{ fontSize: '0.85rem' }}>
          <FiAlertTriangle className="me-2 fs-5" />
          <div>{errorMsg}</div>
        </div>
      )}

      {successMsg && (
        <div className="alert alert-success d-flex align-items-center py-2 px-3 mb-4 border-0 rounded-3" style={{ fontSize: '0.85rem' }}>
          <FiCheck className="me-2 fs-5" />
          <div>{successMsg}</div>
        </div>
      )}

      <form id="form-carga" onSubmit={handleProcess}>
        {recentLoads.length > 0 && (
          <div className="mb-3 d-flex flex-wrap align-items-center gap-2 animate-fade-in" style={{ fontSize: '0.85rem' }}>
            <span className="text-muted fw-semibold">Usar reciente:</span>
            {recentLoads.slice(0, 5).map((load, index) => {
              const formattedPeriod = load.periodo.slice(0, 4) + '-' + load.periodo.slice(4);
              return (
                <button
                  key={index}
                  type="button"
                  className="btn btn-sm btn-outline-secondary py-1 px-2.5 rounded-3 font-mono text-xs d-flex align-items-center gap-1 hover-scale"
                  style={{ fontSize: '0.78rem', borderStyle: 'dashed' }}
                  onClick={() => {
                    setPeriodo(load.periodo);
                    setDia(load.dia || '');
                    setVersion(String(load.version || 1));
                  }}
                >
                  {formattedPeriod} (Día {load.dia}, v{load.version})
                </button>
              );
            })}
          </div>
        )}

        <div className="row g-2 mb-4">
          {/* Período Contable */}
          <div className="col-md-4">
            <label className="form-label text-muted" style={{ fontSize: '0.8rem' }}>Período Contable (Año/Mes)</label>
            <div className="position-relative">
              <input
                type="text"
                required
                disabled={loading}
                maxLength={6}
                className="form-control form-control-premium font-mono"
                placeholder="Ej: 202606"
                value={periodo}
                onChange={(e) => setPeriodo(e.target.value)}
                onFocus={() => setShowPeriodSuggestions(true)}
                onBlur={() => setTimeout(() => setShowPeriodSuggestions(false), 200)}
                autoComplete="off"
              />
              {showPeriodSuggestions && recentLoads.length > 0 && (
                (() => {
                  const filteredPeriods = Array.from(new Set(recentLoads.map(l => l.periodo)))
                    .filter(p => p.includes(periodo))
                    .slice(0, 5);
                  if (filteredPeriods.length === 0) return null;
                  return (
                    <ul className="dropdown-premium-menu show w-100" style={{ left: 0, marginTop: '4px' }}>
                      {filteredPeriods.map(p => (
                        <li key={p}>
                          <button
                            type="button"
                            className="dropdown-premium-item font-mono text-start w-100"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setPeriodo(p);
                              setShowPeriodSuggestions(false);
                            }}
                          >
                            {p.slice(0, 4) + '-' + p.slice(4)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  );
                })()
              )}
            </div>
            <small className="text-muted d-block mt-1" style={{ fontSize: '0.72rem' }}>Formato: AAAAMM (Año y Mes)</small>
          </div>

          {/* Día de Carga */}
          <div className="col-md-4">
            <label className="form-label text-muted" style={{ fontSize: '0.8rem' }}>Día de Carga</label>
            <div className="position-relative">
              <input
                type="text"
                required
                disabled={loading}
                maxLength={2}
                className="form-control form-control-premium font-mono"
                placeholder="Ej: 25"
                value={dia}
                onChange={(e) => setDia(e.target.value)}
                onFocus={() => setShowDiaSuggestions(true)}
                onBlur={() => setTimeout(() => setShowDiaSuggestions(false), 200)}
                autoComplete="off"
              />
              {showDiaSuggestions && recentLoads.length > 0 && (
                (() => {
                  const filteredDays = Array.from(new Set(recentLoads.map(l => l.dia).filter(Boolean)))
                    .filter(d => d.includes(dia))
                    .slice(0, 5);
                  if (filteredDays.length === 0) return null;
                  return (
                    <ul className="dropdown-premium-menu show w-100" style={{ left: 0, marginTop: '4px' }}>
                      {filteredDays.map(d => (
                        <li key={d}>
                          <button
                            type="button"
                            className="dropdown-premium-item font-mono text-start w-100"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setDia(d);
                              setShowDiaSuggestions(false);
                            }}
                          >
                            {d}
                          </button>
                        </li>
                      ))}
                    </ul>
                  );
                })()
              )}
            </div>
            <small className="text-muted d-block mt-1" style={{ fontSize: '0.72rem' }}>Día del mes (1-31)</small>
          </div>

          {/* Versión */}
          <div className="col-md-4">
            <label className="form-label text-muted" style={{ fontSize: '0.8rem' }}>Versión</label>
            <div className="position-relative">
              <input
                type="number"
                required
                disabled={loading}
                min={1}
                className="form-control form-control-premium font-mono"
                placeholder="Ej: 1"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                onFocus={() => setShowVersionSuggestions(true)}
                onBlur={() => setTimeout(() => setShowVersionSuggestions(false), 200)}
                autoComplete="off"
              />
              {showVersionSuggestions && recentLoads.length > 0 && (
                (() => {
                  const filteredVersions = Array.from(new Set(recentLoads.map(l => String(l.version || 1))))
                    .filter(v => v.includes(version))
                    .slice(0, 5);
                  if (filteredVersions.length === 0) return null;
                  return (
                    <ul className="dropdown-premium-menu show w-100" style={{ left: 0, marginTop: '4px' }}>
                      {filteredVersions.map(v => (
                        <li key={v}>
                          <button
                            type="button"
                            className="dropdown-premium-item font-mono text-start w-100"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setVersion(v);
                              setShowVersionSuggestions(false);
                            }}
                          >
                            v{v}
                          </button>
                        </li>
                      ))}
                    </ul>
                  );
                })()
              )}
            </div>
            <small className="text-muted d-block mt-1" style={{ fontSize: '0.72rem' }}>Versión de carga para el día</small>
          </div>
        </div>

        <div className="row g-3 mb-4">
          {/* SAP Dropzone */}
          <div className={`col-xl-${activeModule === 'compras' ? '4' : '3'} col-md-6`}>
            <div 
              className={`dropzone-premium ${sapFile ? 'active' : ''}`}
              onClick={() => document.getElementById('input-sap').click()}
            >
              <input
                id="input-sap"
                type="file"
                accept=".txt"
                className="d-none"
                onChange={(e) => handleFileChange(e, 'sap')}
                disabled={loading}
              />
              {sapFile ? (
                <div>
                  <FiCheck className="text-success fs-2 mb-2" />
                  <div className="fw-semibold text-truncate" style={{ fontSize: '0.85rem' }}>{sapFile.name}</div>
                  <small className="text-muted font-mono" style={{ fontSize: '0.72rem' }}>{(sapFile.size / 1024).toFixed(1)} KB (SAP)</small>
                </div>
              ) : (
                <div>
                  <FiUpload className="text-muted fs-2 mb-2" />
                  <div className="fw-semibold" style={{ fontSize: '0.85rem' }}>{activeModule === 'compras' ? 'Reporte SAP (Compras)' : 'Reporte SAP (1111)'}</div>
                  <small className="text-muted d-block mt-1" style={{ fontSize: '0.75rem' }}>Haga clic para seleccionar archivo TXT</small>
                </div>
              )}
            </div>
          </div>

          {/* SUNAT Dropzone */}
          <div className={`col-xl-${activeModule === 'compras' ? '4' : '3'} col-md-6`}>
            <div 
              className={`dropzone-premium ${sunatFile ? 'active' : ''}`}
              onClick={() => document.getElementById('input-sunat').click()}
            >
              <input
                id="input-sunat"
                type="file"
                accept=".txt"
                className="d-none"
                onChange={(e) => handleFileChange(e, 'sunat')}
                disabled={loading}
              />
              {sunatFile ? (
                <div>
                  <FiCheck className="text-success fs-2 mb-2" />
                  <div className="fw-semibold text-truncate" style={{ fontSize: '0.85rem' }}>{sunatFile.name}</div>
                  <small className="text-muted font-mono" style={{ fontSize: '0.72rem' }}>{(sunatFile.size / 1024).toFixed(1)} KB (SUNAT)</small>
                </div>
              ) : (
                <div>
                  <FiUpload className="text-muted fs-2 mb-2" />
                  <div className="fw-semibold" style={{ fontSize: '0.85rem' }}>{activeModule === 'compras' ? 'Reporte SUNAT (Compras)' : 'Reporte SUNAT (EXP2)'}</div>
                  <small className="text-muted d-block mt-1" style={{ fontSize: '0.75rem' }}>Haga clic para seleccionar archivo TXT</small>
                </div>
              )}
            </div>
          </div>

          {/* SIRE Dropzone */}
          <div className={`col-xl-${activeModule === 'compras' ? '4' : '3'} col-md-6`}>
            <div 
              className={`dropzone-premium ${sireFile ? 'active' : ''}`}
              onClick={() => document.getElementById('input-sire').click()}
            >
              <input
                id="input-sire"
                type="file"
                accept=".txt"
                className="d-none"
                onChange={(e) => handleFileChange(e, 'sire')}
                disabled={loading}
              />
              {sireFile ? (
                <div>
                  <FiCheck className="text-success fs-2 mb-2" />
                  <div className="fw-semibold text-truncate" style={{ fontSize: '0.85rem' }}>{sireFile.name}</div>
                  <small className="text-muted font-mono" style={{ fontSize: '0.72rem' }}>{(sireFile.size / 1024).toFixed(1)} KB (SIRE)</small>
                </div>
              ) : (
                <div>
                  <FiUpload className="text-muted fs-2 mb-2" />
                  <div className="fw-semibold" style={{ fontSize: '0.85rem' }}>{activeModule === 'compras' ? 'LOG SIRE Compras' : 'LOG SIRE Ventas'}</div>
                  <small className="text-muted d-block mt-1" style={{ fontSize: '0.75rem' }}>Haga clic para seleccionar archivo TXT</small>
                </div>
              )}
            </div>
          </div>

          {/* Cortesías Dropzone */}
          {activeModule !== 'compras' && (
            <div className="col-xl-3 col-md-6">
              <div 
                className={`dropzone-premium ${cortesiasFile ? 'active' : ''}`}
                onClick={() => document.getElementById('input-cortesias').click()}
              >
                <input
                  id="input-cortesias"
                  type="file"
                  accept=".xlsx,.xls"
                  className="d-none"
                  onChange={(e) => handleFileChange(e, 'cortesias')}
                  disabled={loading}
                />
                {cortesiasFile ? (
                  <div>
                    <FiCheck className="text-success fs-2 mb-2" />
                    <div className="fw-semibold text-truncate" style={{ fontSize: '0.85rem' }}>{cortesiasFile.name}</div>
                    <small className="text-muted font-mono" style={{ fontSize: '0.72rem' }}>{(cortesiasFile.size / 1024).toFixed(1)} KB (Cortesías)</small>
                  </div>
                ) : (
                  <div>
                    <FiUpload className="text-muted fs-2 mb-2" />
                    <div className="fw-semibold" style={{ fontSize: '0.85rem' }}>Cortesías (Excel - Opcional)</div>
                    <small className="text-muted d-block mt-1" style={{ fontSize: '0.75rem' }}>Haga clic para seleccionar archivo Excel</small>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="d-flex justify-content-between align-items-center">
          <span className="text-muted" style={{ fontSize: '0.85rem' }}>
            {loading ? (
              <span className="text-primary fw-semibold">{statusText}</span>
            ) : (
              'Los archivos son procesados en el navegador de manera segura.'
            )}
          </span>
          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary d-flex align-items-center px-4 py-2 rounded-3 fw-semibold"
            style={{ cursor: 'pointer' }}
          >
            <FiPlay className="me-2" /> Procesar y Conciliar
          </button>
        </div>
      </form>
    </div>
  );
}
