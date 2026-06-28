import React, { useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { parseSAP, parseSUNAT, parseSIRE, stripBOM } from '../utils/parsers';
import { reconcileData } from '../utils/validations';
import { FiUpload, FiFileText, FiCheck, FiPlay, FiAlertTriangle } from 'react-icons/fi';

export default function CargaArchivos({ activeCompany, userProfile, onProcessComplete }) {
  const [periodo, setPeriodo] = useState(''); // Formato YYYYMM, ej. 202606
  const [sapFile, setSapFile] = useState(null);
  const [sunatFile, setSunatFile] = useState(null);
  const [sireFile, setSireFile] = useState(null);
  
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleFileChange = (e, type) => {
    const file = e.target.files[0];
    if (file) {
      if (type === 'sap') setSapFile(file);
      if (type === 'sunat') setSunatFile(file);
      if (type === 'sire') setSireFile(file);
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

      setStatusText('Parseando registros...');
      const sunatData = parseSUNAT(sunatText);
      const sapData = parseSAP(sapText);
      const sireData = parseSIRE(sireText);

      if (sunatData.length === 0) throw new Error('El archivo de SUNAT está vacío o no coincide con el formato.');
      if (sapData.length === 0) throw new Error('El archivo de SAP está vacío o no coincide con el formato.');
      if (sireData.length === 0) throw new Error('El archivo de SIRE está vacío o no coincide con el formato.');

      setStatusText('Conciliando y aplicando reglas tributarias...');
      const reconciledList = reconcileData(sapData, sunatData, sireData, activeCompany.ruc);

      setStatusText(`Preparando ${reconciledList.length} registros para base de datos...`);

      // 2. Crear período de carga en Supabase
      const { data: periodData, error: periodErr } = await supabase
        .from('periodos_carga')
        .insert({
          empresa_id: activeCompany.id,
          usuario_id: userProfile.id,
          periodo: periodo,
          estado: 'procesando'
        })
        .select()
        .single();

      if (periodErr) throw periodErr;
      const periodId = periodData.id;

      // 3. Subir en bloques de 1000 para evitar sobrecarga o límites del query
      setStatusText('Cargando registros unificados a Supabase...');
      const chunkSize = 1000;
      for (let i = 0; i < reconciledList.length; i += chunkSize) {
        const chunk = reconciledList.slice(i, i + chunkSize).map(r => ({
          periodo_id: periodId,
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
          otros_sap: r.otros_sap,
          total_sap: r.total_sap,
          
          tipo_identidad_sunat: r.tipo_identidad_sunat,
          nro_identidad_sunat: r.nro_identidad_sunat,
          nombre_sunat: r.nombre_sunat,
          base_sunat: r.base_sunat,
          igv_sunat: r.igv_sunat,
          otros_sunat: r.otros_sunat,
          total_sunat: r.total_sunat,
          
          mensaje_sire: r.mensaje_sire,
          tipo_pago_sire: r.tipo_pago_sire,
          estado_validacion: r.estado_validacion,
          errores_json: r.errores_json
        }));

        const { error: insertErr } = await supabase
          .from('detalle_validacion')
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

      setSuccessMsg(`¡Proceso exitoso! Se cargaron y conciliaron ${reconciledList.length} registros del período ${periodo}.`);
      
      // Limpiar inputs
      setSapFile(null);
      setSunatFile(null);
      setSireFile(null);
      document.getElementById('form-carga').reset();

      // Notificar al componente principal
      onProcessComplete(periodId, periodo);

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
      <h4 className="text-white mb-3 fw-bold">Nueva Carga de Reportes Mensuales</h4>
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
        <div className="row">
          <div className="col-md-4 mb-4">
            <label className="form-label text-muted" style={{ fontSize: '0.8rem' }}>Período Contable</label>
            <input
              type="text"
              required
              disabled={loading}
              maxLength={6}
              className="form-control form-control-premium font-mono"
              placeholder="Ej: 202606"
              value={periodo}
              onChange={(e) => setPeriodo(e.target.value)}
            />
            <small className="text-muted d-block mt-1" style={{ fontSize: '0.72rem' }}>Formato: AAAAMM (Año y Mes)</small>
          </div>
        </div>

        <div className="row g-3 mb-4">
          {/* SAP Dropzone */}
          <div className="col-lg-4">
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
                  <div className="text-white fw-semibold text-truncate" style={{ fontSize: '0.85rem' }}>{sapFile.name}</div>
                  <small className="text-muted font-mono" style={{ fontSize: '0.72rem' }}>{(sapFile.size / 1024).toFixed(1)} KB (SAP)</small>
                </div>
              ) : (
                <div>
                  <FiUpload className="text-muted fs-2 mb-2" />
                  <div className="text-white fw-semibold" style={{ fontSize: '0.85rem' }}>Reporte SAP (1111)</div>
                  <small className="text-muted d-block mt-1" style={{ fontSize: '0.75rem' }}>Haga clic para seleccionar archivo TXT</small>
                </div>
              )}
            </div>
          </div>

          {/* SUNAT Dropzone */}
          <div className="col-lg-4">
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
                  <div className="text-white fw-semibold text-truncate" style={{ fontSize: '0.85rem' }}>{sunatFile.name}</div>
                  <small className="text-muted font-mono" style={{ fontSize: '0.72rem' }}>{(sunatFile.size / 1024).toFixed(1)} KB (SUNAT)</small>
                </div>
              ) : (
                <div>
                  <FiUpload className="text-muted fs-2 mb-2" />
                  <div className="text-white fw-semibold" style={{ fontSize: '0.85rem' }}>Reporte SUNAT (EXP2)</div>
                  <small className="text-muted d-block mt-1" style={{ fontSize: '0.75rem' }}>Haga clic para seleccionar archivo TXT</small>
                </div>
              )}
            </div>
          </div>

          {/* SIRE Dropzone */}
          <div className="col-lg-4">
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
                  <div className="text-white fw-semibold text-truncate" style={{ fontSize: '0.85rem' }}>{sireFile.name}</div>
                  <small className="text-muted font-mono" style={{ fontSize: '0.72rem' }}>{(sireFile.size / 1024).toFixed(1)} KB (SIRE)</small>
                </div>
              ) : (
                <div>
                  <FiUpload className="text-muted fs-2 mb-2" />
                  <div className="text-white fw-semibold" style={{ fontSize: '0.85rem' }}>LOG SIRE Ventas</div>
                  <small className="text-muted d-block mt-1" style={{ fontSize: '0.75rem' }}>Haga clic para seleccionar archivo TXT</small>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="d-flex justify-content-between align-items-center">
          <span className="text-muted" style={{ fontSize: '0.85rem' }}>
            {loading ? (
              <span className="text-primary fw-semibold">{statusText}</span>
            ) : (
              'Los 3 archivos son procesados en el navegador de manera segura.'
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
