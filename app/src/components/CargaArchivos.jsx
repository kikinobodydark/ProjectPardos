import React, { useState, memo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../utils/supabaseClient';
import {
  getOrCreateCsrfToken,
  verifyCsrfToken,
  checkRateLimit,
  validateUploadedFile,
  validateFileMagicBytes,
} from '../utils/security';
import {
  runCpuTaskInWorker,
  serializeDocsInWorkerPool,
  serializeComprasDocsInWorkerPool,
  executeParallelBatches,
} from '../utils/jobQueue';
import { idbSetQuery } from '../utils/queryPersister';
import { useNetworkProfile } from '../utils/networkProfile';
import {
  FiUpload, FiCheck, FiPlay, FiAlertTriangle, FiXCircle,
  FiRefreshCw, FiTrash2, FiChevronDown, FiChevronUp, FiFileText,
} from 'react-icons/fi';

const CargaArchivos = memo(function CargaArchivos({
  activeCompany,
  userProfile,
  onProcessComplete,
  activeModule,
  periods = [],
}) {
  const queryClient = useQueryClient();
  const networkProfile = useNetworkProfile();
  const [csrfToken] = useState(() => getOrCreateCsrfToken());
  const esVentas = activeModule !== 'compras';

  const [periodo, setPeriodo] = useState('');
  const [dia, setDia] = useState(() => String(new Date().getDate()).padStart(2, '0'));
  const [version, setVersion] = useState('1');

  const [sapFile, setSapFile] = useState(null);
  const [sunatFile, setSunatFile] = useState(null);
  const [cortesiasFile, setCortesiasFile] = useState(null);
  const [usuariosSapFile, setUsuariosSapFile] = useState(null);

  // Resultados de validación de lectura previa (Ventas y Compras - procesados en Pool de Web Workers)
  const [lecturaSap, setLecturaSap] = useState(null);
  const [lecturaSunat, setLecturaSunat] = useState(null);
  const [lecturaCortesias, setLecturaCortesias] = useState(null);
  const [lecturaUsuariosSap, setLecturaUsuariosSap] = useState(null);
  const [detalleAbierto, setDetalleAbierto] = useState({
    sap: false,
    sunat: false,
    cortesias: false,
    usuariosSap: false,
  });

  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [progressPct, setProgressPct] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [showPeriodSuggestions, setShowPeriodSuggestions] = useState(false);
  const [showDiaSuggestions, setShowDiaSuggestions] = useState(false);
  const [showVersionSuggestions, setShowVersionSuggestions] = useState(false);

  const recentLoads = periods.slice(0, 10);

  const readFileAsArrayBuffer = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => resolve(event.target.result);
      reader.onerror = (err) => reject(err);
      reader.readAsArrayBuffer(file);
    });

  const readExcelFile = async (file) => {
    const buffer = await readFileAsArrayBuffer(file);
    const sigCheck = validateFileMagicBytes(buffer, 'excel');
    if (!sigCheck.valid) {
      throw new Error(sigCheck.error);
    }
    const XLSX = await import('xlsx');
    const data = new Uint8Array(buffer);
    const workbook = XLSX.read(data, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(sheet, { raw: false, defval: '' });
  };

  // Lectura y validación inmediata en Web Worker con Transferable ArrayBuffer (zero-copy)
  const handleFileChange = async (e, type) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg('');
    setSuccessMsg('');

    const esExcel = type === 'cortesias' || type === 'usuariosSap';
    const check = validateUploadedFile(file, esExcel ? 'excel' : 'txt');
    if (!check.valid) {
      setErrorMsg(check.error);
      e.target.value = '';
      return;
    }

    try {
      if (type === 'sap') {
        setSapFile(file);
        const buffer = await readFileAsArrayBuffer(file);
        const sigCheck = validateFileMagicBytes(buffer, 'txt');
        if (!sigCheck.valid) throw new Error(sigCheck.error);
        const action = esVentas ? 'PARSE_SAP_VENTAS' : 'PARSE_SAP_COMPRAS';
        const res = await runCpuTaskInWorker(action, { buffer }, [buffer]);
        setLecturaSap(res);
        if (res.periodoDetectado && !periodo) setPeriodo(res.periodoDetectado);
      } else if (type === 'sunat') {
        setSunatFile(file);
        const buffer = await readFileAsArrayBuffer(file);
        const sigCheck = validateFileMagicBytes(buffer, 'txt');
        if (!sigCheck.valid) throw new Error(sigCheck.error);
        const action = esVentas ? 'PARSE_SUNAT_VENTAS' : 'PARSE_SUNAT_COMPRAS';
        const res = await runCpuTaskInWorker(action, { buffer }, [buffer]);
        const nextRes =
          activeCompany?.ruc && res.rucDetectado && res.rucDetectado !== activeCompany.ruc
            ? {
                ...res,
                advertencias: [
                  ...(res.advertencias || []),
                  `El RUC del archivo (${res.rucDetectado}) difiere de la empresa activa (${activeCompany.ruc}).`,
                ],
                estado: res.estado === 'ok' ? 'advertencia' : res.estado,
              }
            : res;
        setLecturaSunat(nextRes);
        if (nextRes.periodoDetectado && !periodo) setPeriodo(nextRes.periodoDetectado);
      } else if (type === 'cortesias' && esVentas) {
        setCortesiasFile(file);
        const filas = await readExcelFile(file);
        const res = await runCpuTaskInWorker('PARSE_CORTESIAS', { filas });
        setLecturaCortesias(res);
      } else if (type === 'usuariosSap' && !esVentas) {
        setUsuariosSapFile(file);
        const filas = await readExcelFile(file);
        const res = await runCpuTaskInWorker('PARSE_USUARIOS_SAP_COMPRAS', { filas });
        setLecturaUsuariosSap(res);
      }
    } catch (err) {
      const fallo = {
        estado: 'error',
        formato: esExcel ? 'Excel (.xlsx / .xls)' : 'TXT delimitado por "|"',
        mensaje: err.message || 'No se pudo leer el archivo.',
        registrosValidos: 0,
        registrosLeidos: 0,
        lineasVacias: 0,
        registrosIncompletos: [],
        erroresTipo: [],
        totalErroresTipo: 0,
        duplicados: [],
        columnasFaltantes: [],
        advertencias: [],
        registros: [],
      };
      if (type === 'sap') setLecturaSap(fallo);
      if (type === 'sunat') setLecturaSunat(fallo);
      if (type === 'cortesias') setLecturaCortesias(fallo);
      if (type === 'usuariosSap') setLecturaUsuariosSap(fallo);
    }
    e.target.value = '';
  };

  const limpiarArchivo = (type, e) => {
    if (e) e.stopPropagation();
    if (type === 'sap') { setSapFile(null); setLecturaSap(null); }
    if (type === 'sunat') { setSunatFile(null); setLecturaSunat(null); }
    if (type === 'cortesias') { setCortesiasFile(null); setLecturaCortesias(null); }
    if (type === 'usuariosSap') { setUsuariosSapFile(null); setLecturaUsuariosSap(null); }
  };

  const sapValido = !!sapFile && lecturaSap && lecturaSap.estado !== 'error' && lecturaSap.registrosValidos > 0;
  const sunatValido = !!sunatFile && lecturaSunat && lecturaSunat.estado !== 'error' && lecturaSunat.registrosValidos > 0;
  const cortesiasInvalido = esVentas && !!cortesiasFile && lecturaCortesias && lecturaCortesias.estado === 'error';
  const usuariosSapInvalido = !esVentas && !!usuariosSapFile && lecturaUsuariosSap && lecturaUsuariosSap.estado === 'error';
  const botonHabilitado = sapValido && sunatValido && !cortesiasInvalido && !usuariosSapInvalido && !loading;

  const handleProcess = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!verifyCsrfToken(csrfToken)) {
      setErrorMsg('Token de seguridad CSRF inválido. Recarga la página.');
      return;
    }

    const rl = checkRateLimit('file_upload_process', { maxAttempts: 6, windowMs: 60000, lockoutMs: 60000 });
    if (!rl.allowed) {
      setErrorMsg(rl.message);
      return;
    }

    if (!sapValido || !sunatValido) {
      setErrorMsg('Debe cargar correctamente los dos archivos TXT obligatorios (Archivo SAP y Archivo SUNAT).');
      return;
    }
    if (esVentas && cortesiasInvalido) {
      setErrorMsg('El archivo opcional de cortesías presenta errores de estructura. Reemplácelo o quítelo antes de procesar.');
      return;
    }
    if (!esVentas && usuariosSapInvalido) {
      setErrorMsg('El archivo opcional de usuarios SAP presenta errores de estructura. Reemplácelo o quítelo antes de procesar.');
      return;
    }

    const periodoFinal = (periodo || lecturaSunat?.periodoDetectado || lecturaSap?.periodoDetectado || '').trim();
    if (periodoFinal.length !== 6 || !/^\d+$/.test(periodoFinal)) {
      setErrorMsg('El período contable debe tener 6 dígitos numéricos (AAAAMM).');
      return;
    }

    const year = parseInt(periodoFinal.slice(0, 4), 10);
    const month = parseInt(periodoFinal.slice(4, 6), 10);
    const maxDia = new Date(year, month, 0).getDate();
    const diaNum = parseInt(dia, 10);
    if (isNaN(diaNum) || diaNum < 1 || diaNum > maxDia) {
      setErrorMsg(`El día debe estar entre 1 y ${maxDia} para el período ${periodoFinal.slice(0, 4)}-${periodoFinal.slice(4)}.`);
      return;
    }

    const versionNum = parseInt(version, 10);
    if (isNaN(versionNum) || versionNum < 1) {
      setErrorMsg('La versión debe ser un número entero positivo.');
      return;
    }

    // Guardia de RUC: evitar cargar accidentalmente archivos SUNAT de otra empresa
    if (activeCompany?.ruc && lecturaSunat?.rucDetectado && lecturaSunat.rucDetectado !== activeCompany.ruc) {
      const confirmarRuc = window.confirm(
        `ADVERTENCIA DE SEGURIDAD CONTABLE\n\nEl archivo SUNAT pertenece al RUC ${lecturaSunat.rucDetectado}, pero la empresa activa es ${activeCompany.razon_social} (RUC ${activeCompany.ruc}).\n\n¿Estás seguro de continuar y guardar estos comprobantes bajo ${activeCompany.razon_social}?`
      );
      if (!confirmarRuc) {
        setErrorMsg(
          `Carga cancelada: el RUC del archivo SUNAT (${lecturaSunat.rucDetectado}) no coincide con la empresa activa (${activeCompany.ruc}).`
        );
        return;
      }
    }

    setLoading(true);
    setProgressPct(5);
    const chunkSize = Math.min(500, networkProfile.recommendedBatchSize || 500);
    const concurrency = Math.min(2, networkProfile.recommendedConcurrency || 2);
    const diaPadded = String(diaNum).padStart(2, '0');
    // Versión temporal negativa en staging para NO borrar la carga previa válida hasta confirmar todos los lotes
    const stagingVersion = -Math.max(1, (Date.now() % 1_000_000_000) + Math.floor(Math.random() * 1000));

    const esRpcFaltante = (err) => {
      const msg = err?.message || '';
      return (
        err?.code === '42883' ||
        err?.code === 'PGRST202' ||
        msg.includes('Could not find the function')
      );
    };

    const esErrorReintentable = (err) => {
      const code = err?.code || '';
      const msg = (err?.message || '').toLowerCase();
      return (
        code === '57014' ||
        code === '53300' ||
        code === '40P01' ||
        code === '08006' ||
        msg.includes('statement timeout') ||
        msg.includes('canceling statement') ||
        msg.includes('timeout') ||
        msg.includes('failed to fetch') ||
        msg.includes('network') ||
        msg.includes('502') ||
        msg.includes('503') ||
        msg.includes('504')
      );
    };

    const insertarLoteConReintento = async ({
      rpcName,
      tableName,
      periodId,
      filas,
      onInserted,
      attempt = 0,
    }) => {
      if (!filas || filas.length === 0) return;

      const { error: rpcErr } = await supabase.rpc(rpcName, {
        p_periodo_id: periodId,
        p_empresa_id: activeCompany.id,
        p_filas: filas,
      });

      let finalErr = rpcErr;
      if (rpcErr && esRpcFaltante(rpcErr)) {
        const { error: insertErr } = await supabase.from(tableName).insert(filas);
        finalErr = insertErr;
      }

      if (!finalErr) {
        onInserted(filas.length);
        return;
      }

      // Ante timeout o error transitorio: dividir el lote en sub-lotes más pequeños y reintentar secuencialmente
      if (esErrorReintentable(finalErr) && filas.length > 100) {
        const mid = Math.ceil(filas.length / 2);
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        await insertarLoteConReintento({
          rpcName,
          tableName,
          periodId,
          filas: filas.slice(0, mid),
          onInserted,
          attempt: attempt + 1,
        });
        await insertarLoteConReintento({
          rpcName,
          tableName,
          periodId,
          filas: filas.slice(mid),
          onInserted,
          attempt: attempt + 1,
        });
        return;
      }

      if (esErrorReintentable(finalErr) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        return insertarLoteConReintento({
          rpcName,
          tableName,
          periodId,
          filas,
          onInserted,
          attempt: attempt + 1,
        });
      }

      throw finalErr;
    };

    const publicarPeriodoAtomico = async (periodId) => {
      setStatusText('Finalizando y publicando período...');
      setProgressPct(97);
      const { error: finErr } = await supabase.rpc('finalizar_periodo_carga', {
        p_periodo_id: periodId,
        p_target_version: versionNum,
      });
      if (!finErr) return;

      if (!esRpcFaltante(finErr)) throw finErr;

      // Fallback si la RPC aún no ha sido migrada en la BD remota
      await supabase
        .from('periodos_carga')
        .delete()
        .neq('id', periodId)
        .eq('empresa_id', activeCompany.id)
        .eq('periodo', periodoFinal)
        .eq('dia', diaPadded)
        .eq('version', versionNum)
        .eq('modulo', activeModule);

      const { error: updErr } = await supabase
        .from('periodos_carga')
        .update({ version: versionNum, estado: 'completado' })
        .eq('id', periodId);
      if (updErr) throw updErr;
    };

    try {
      if (esVentas) {
        setStatusText('Conciliando comprobantes y preparando período...');

        // 1. Lanzar la conciliación en el Worker AL MISMO TIEMPO que se crea la cabecera en staging
        const [conciliacionRes, periodRes] = await Promise.all([
          runCpuTaskInWorker('CONCILIAR_VENTAS', {
            sap: lecturaSap.registros,
            sunat: lecturaSunat.registros,
            cortesias: lecturaCortesias?.registros || null,
          }),
          supabase
            .from('periodos_carga')
            .insert({
              empresa_id: activeCompany.id,
              usuario_id: userProfile.id,
              periodo: periodoFinal,
              dia: diaPadded,
              version: stagingVersion,
              estado: 'procesando',
              modulo: activeModule,
            })
            .select('id')
            .single(),
        ]);

        if (periodRes.error) throw periodRes.error;
        const periodId = periodRes.data.id;
        const { docs } = conciliacionRes;
        setProgressPct(25);

        // 2. Dividir la serialización de las filas (`aFilaBD`) entre el Pool de Web Workers en paralelo
        setStatusText(`Preparando ${docs.length.toLocaleString('es-PE')} comprobantes en paralelo (Pool de Workers)...`);
        const serializedChunks = await serializeDocsInWorkerPool(
          docs,
          { periodoId: periodId, empresaId: activeCompany.id, ruc: activeCompany.ruc },
          chunkSize
        );
        setProgressPct(40);

        // 3. Insertar lotes progresivamente con reintento adaptativo ante timeout
        let insertedCount = 0;
        const registrarAvance = (cantidad) => {
          insertedCount += cantidad;
          const pct = Math.min(95, 40 + Math.round((insertedCount / Math.max(1, docs.length)) * 55));
          setProgressPct(pct);
          setStatusText(`Guardando en Supabase (${insertedCount.toLocaleString('es-PE')} / ${docs.length.toLocaleString('es-PE')})...`);
        };
        setStatusText(`Guardando ${docs.length.toLocaleString('es-PE')} registros en Supabase...`);
        try {
          await executeParallelBatches(
            serializedChunks,
            1,
            async ([chunk]) => {
              await insertarLoteConReintento({
                rpcName: 'insertar_lote_ventas',
                tableName: 'detalle_ventas',
                periodId,
                filas: chunk,
                onInserted: registrarAvance,
              });
            },
            {
              concurrency,
              label: 'BulkRpcVentas',
            }
          );

          await publicarPeriodoAtomico(periodId);
        } catch (insertErr) {
          // Limpiar únicamente el período en staging para preservar cualquier carga previa válida
          try {
            await supabase.from('periodos_carga').delete().eq('id', periodId);
          } catch {
            // No enmascarar el error original
          }
          throw insertErr;
        }

        setProgressPct(100);
        queryClient.setQueryData(['ventasDocumentos', periodId], docs);
        idbSetQuery(JSON.stringify(['ventasDocumentos', periodId]), ['ventasDocumentos', periodId], docs);

        setSuccessMsg(
          `¡Validación completada! Se conciliaron ${docs.length.toLocaleString('es-PE')} comprobantes únicos del período ${periodoFinal}.`
        );
        setSapFile(null);
        setSunatFile(null);
        setCortesiasFile(null);
        setLecturaSap(null);
        setLecturaSunat(null);
        setLecturaCortesias(null);

        onProcessComplete(periodId, `${periodoFinal} (Día: ${diaPadded}, v${versionNum})`);
      } else {
        // Flujo de Compras (TXT SAP + TXT SUNAT + Excel opcional de usuarios SAP):
        setStatusText('Conciliando comprobantes de Compras (SAP vs. SUNAT) y preparando período...');

        // 1. Lanzar la conciliación en el Worker AL MISMO TIEMPO que se crea la cabecera en staging
        const [conciliacionRes, periodRes] = await Promise.all([
          runCpuTaskInWorker('CONCILIAR_COMPRAS_V2', {
            sap: lecturaSap.registros,
            sunat: lecturaSunat.registros,
            usuariosSap: lecturaUsuariosSap?.registros || null,
          }),
          supabase
            .from('periodos_carga')
            .insert({
              empresa_id: activeCompany.id,
              usuario_id: userProfile.id,
              periodo: periodoFinal,
              dia: diaPadded,
              version: stagingVersion,
              estado: 'procesando',
              modulo: activeModule,
            })
            .select('id')
            .single(),
        ]);

        if (periodRes.error) throw periodRes.error;
        const periodId = periodRes.data.id;
        const { docs } = conciliacionRes;
        setProgressPct(25);

        // 2. Serializar filas en el Pool de Web Workers
        setStatusText(`Preparando ${docs.length.toLocaleString('es-PE')} documentos de Compras en paralelo...`);
        const serializedChunks = await serializeComprasDocsInWorkerPool(
          docs,
          { periodoId: periodId, empresaId: activeCompany.id },
          chunkSize
        );
        setProgressPct(40);

        // 3. Insertar lotes progresivamente con reintento adaptativo ante timeout
        let insertedCount = 0;
        const registrarAvance = (cantidad) => {
          insertedCount += cantidad;
          const pct = Math.min(95, 40 + Math.round((insertedCount / Math.max(1, docs.length)) * 55));
          setProgressPct(pct);
          setStatusText(`Guardando en Supabase (${insertedCount.toLocaleString('es-PE')} / ${docs.length.toLocaleString('es-PE')})...`);
        };
        setStatusText(`Guardando ${docs.length.toLocaleString('es-PE')} registros en Supabase...`);
        try {
          await executeParallelBatches(
            serializedChunks,
            1,
            async ([chunk]) => {
              await insertarLoteConReintento({
                rpcName: 'insertar_lote_compras',
                tableName: 'detalle_compras',
                periodId,
                filas: chunk,
                onInserted: registrarAvance,
              });
            },
            {
              concurrency,
              label: 'BulkRpcCompras',
            }
          );

          await publicarPeriodoAtomico(periodId);
        } catch (insertErr) {
          // Limpiar únicamente el período en staging para preservar cualquier carga previa válida
          try {
            await supabase.from('periodos_carga').delete().eq('id', periodId);
          } catch {
            // No enmascarar el error original
          }
          throw insertErr;
        }

        setProgressPct(100);
        queryClient.setQueryData(['comprasDocumentos', periodId], docs);
        idbSetQuery(JSON.stringify(['comprasDocumentos', periodId]), ['comprasDocumentos', periodId], docs);

        setSuccessMsg(
          `¡Conciliación de Compras completada! Se validaron ${docs.length.toLocaleString('es-PE')} documentos únicos del período ${periodoFinal}.`
        );
        setSapFile(null);
        setSunatFile(null);
        setUsuariosSapFile(null);
        setLecturaSap(null);
        setLecturaSunat(null);
        setLecturaUsuariosSap(null);
        onProcessComplete(periodId, `${periodoFinal} (Día: ${diaPadded}, v${versionNum})`);
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error(err);
      setErrorMsg(err.message || 'Ocurrió un error inesperado al procesar y guardar la validación.');
    } finally {
      setLoading(false);
      setStatusText('');
      setProgressPct(0);
    }
  };

  const renderTarjetaArchivo = ({ tipo, inputId, accept, titulo, subtitulo, obligatorio, file, lectura, colClass = 'col-lg-4 col-md-6' }) => {
    const abierto = detalleAbierto[tipo];
    const tieneHallazgos =
      lectura &&
      (lectura.lineasVacias > 0 ||
        lectura.registrosIncompletos?.length > 0 ||
        lectura.totalErroresTipo > 0 ||
        lectura.duplicados?.length > 0 ||
        lectura.columnasFaltantes?.length > 0 ||
        lectura.advertencias?.length > 0);

    const colorBorde = !lectura
      ? undefined
      : lectura.estado === 'error'
        ? '#DC2626'
        : lectura.estado === 'advertencia'
          ? '#D97706'
          : '#059669';

    const bgEstado = !lectura
      ? undefined
      : lectura.estado === 'error'
        ? 'rgba(220, 38, 38, 0.06)'
        : lectura.estado === 'advertencia'
          ? 'rgba(217, 119, 6, 0.06)'
          : 'rgba(5, 150, 105, 0.06)';

    return (
      <div className={colClass}>
        <div
          className={`dropzone-premium h-100 d-flex flex-column justify-content-between text-start p-3 ${file ? 'active' : ''}`}
          style={{ borderColor: colorBorde, backgroundColor: bgEstado, cursor: 'pointer' }}
          onClick={() => document.getElementById(inputId).click()}
        >
          <input
            id={inputId}
            type="file"
            accept={accept}
            className="d-none"
            onChange={(e) => handleFileChange(e, tipo)}
            disabled={loading}
          />

          <div>
            <div className="d-flex justify-content-between align-items-center mb-2">
              <span className="fw-bold" style={{ fontSize: '0.9rem', color: 'var(--color-text)' }}>
                {titulo}
              </span>
              <span
                className="badge font-mono"
                style={{
                  backgroundColor: obligatorio ? 'rgba(37, 99, 235, 0.1)' : 'rgba(100, 116, 139, 0.12)',
                  color: obligatorio ? '#2563EB' : '#475569',
                  fontSize: '0.68rem',
                }}
              >
                {obligatorio ? 'OBLIGATORIO' : 'OPCIONAL'}
              </span>
            </div>

            {!file ? (
              <div className="text-center py-3">
                <FiUpload className="text-muted fs-2 mb-2" />
                <div className="fw-semibold" style={{ fontSize: '0.84rem' }}>{subtitulo}</div>
                <small className="text-muted d-block mt-1" style={{ fontSize: '0.74rem' }}>
                  Haga clic para seleccionar archivo ({accept})
                </small>
              </div>
            ) : (
              <div>
                <div className="d-flex align-items-center gap-2 mb-2">
                  {lectura?.estado === 'error' ? (
                    <FiXCircle className="text-danger fs-4 flex-shrink-0" />
                  ) : lectura?.estado === 'advertencia' ? (
                    <FiAlertTriangle className="text-warning fs-4 flex-shrink-0" />
                  ) : (
                    <FiCheck className="text-success fs-4 flex-shrink-0" />
                  )}
                  <div className="text-truncate">
                    <div className="fw-semibold text-truncate" style={{ fontSize: '0.84rem' }} title={file.name}>
                      {file.name}
                    </div>
                    <small className="text-muted font-mono" style={{ fontSize: '0.72rem' }}>
                      {(file.size / 1024).toFixed(1)} KB · {lectura?.formato}
                      {lectura?.codificacion ? ` · ${lectura.codificacion}` : ''}
                    </small>
                  </div>
                </div>

                {lectura && (
                  <div
                    className="p-2 rounded-2 mb-2"
                    style={{ backgroundColor: 'rgba(255,255,255,0.75)', border: '1px solid var(--border-color)', fontSize: '0.78rem' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="d-flex justify-content-between align-items-center mb-1">
                      <span className="fw-semibold">Estado de carga:</span>
                      <span
                        className={`badge badge-status badge-status-${lectura.estado === 'error' ? 'error' : lectura.estado === 'advertencia' ? 'observado' : 'ok'
                          }`}
                      >
                        {lectura.estado === 'error' ? 'ERROR DE LECTURA' : lectura.estado === 'advertencia' ? 'CARGADO CON OBSERVACIONES' : 'VÁLIDO'}
                      </span>
                    </div>
                    <div className="text-muted mb-1">{lectura.mensaje}</div>
                    <div className="d-flex flex-wrap gap-2 font-mono" style={{ fontSize: '0.73rem' }}>
                      <span>Leídos: <strong>{lectura.registrosLeidos}</strong></span>
                      <span>Únicos válidos: <strong className="text-success">{lectura.registrosValidos}</strong></span>
                      {lectura.duplicados?.length > 0 && (
                        <span className="text-warning">Duplicados: <strong>{lectura.duplicados.length}</strong></span>
                      )}
                      {lectura.lineasVacias > 0 && (
                        <span className="text-muted">Vacíos: <strong>{lectura.lineasVacias}</strong></span>
                      )}
                      {lectura.registrosIncompletos?.length > 0 && (
                        <span className="text-danger">Cols. faltantes: <strong>{lectura.registrosIncompletos.length}</strong></span>
                      )}
                      {lectura.totalErroresTipo > 0 && (
                        <span className="text-danger">Err. tipo dato: <strong>{lectura.totalErroresTipo}</strong></span>
                      )}
                    </div>

                    {tieneHallazgos && (
                      <div className="mt-1 pt-1 border-top" style={{ borderColor: 'var(--border-color)' }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-link p-0 text-decoration-none d-flex align-items-center"
                          style={{ fontSize: '0.74rem' }}
                          onClick={() => setDetalleAbierto((p) => ({ ...p, [tipo]: !p[tipo] }))}
                        >
                          {abierto ? <FiChevronUp className="me-1" /> : <FiChevronDown className="me-1" />}
                          {abierto ? 'Ocultar detalle de lectura' : 'Ver detalle de validaciones de carga'}
                        </button>
                        {abierto && (
                          <div className="mt-1" style={{ maxHeight: '130px', overflowY: 'auto', fontSize: '0.73rem' }}>
                            {lectura.columnasFaltantes?.length > 0 && (
                              <div className="text-danger">• Columnas faltantes: {lectura.columnasFaltantes.join(', ')}</div>
                            )}
                            {lectura.advertencias?.map((a, i) => (
                              <div key={`adv-${i}`} className="text-warning">• {a}</div>
                            ))}
                            {lectura.duplicados?.slice(0, 10).map((d, i) => (
                              <div key={`dup-${i}`} className="text-warning">
                                • Duplicado {d.folio} (líneas {d.lineas.join(', ')}) — se conserva la primera aparición.
                              </div>
                            ))}
                            {lectura.registrosIncompletos?.slice(0, 10).map((r, i) => (
                              <div key={`inc-${i}`} className="text-danger">
                                • Línea {r.linea}: {r.columnas} columnas (estructura incompleta).
                              </div>
                            ))}
                            {lectura.erroresTipo?.slice(0, 10).map((er, i) => (
                              <div key={`err-${i}`} className="text-danger">
                                • Línea {er.linea} · {er.campo}: valor inválido "{er.valor}".
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {file && (
            <div className="d-flex justify-content-end gap-2 mt-1" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="btn btn-sm btn-outline-primary py-1 px-2 d-flex align-items-center"
                style={{ fontSize: '0.75rem' }}
                disabled={loading}
                onClick={() => document.getElementById(inputId).click()}
              >
                <FiRefreshCw className="me-1" /> Reemplazar archivo
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary py-1 px-2 d-flex align-items-center"
                style={{ fontSize: '0.75rem' }}
                disabled={loading}
                onClick={(e) => limpiarArchivo(tipo, e)}
              >
                <FiTrash2 className="me-1" /> Quitar
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="card-premium animate-fade-in w-100 p-4">
      <h4 className="mb-1 fw-bold" style={{ color: 'var(--color-text)', letterSpacing: '-0.02em' }}>
        {esVentas
          ? 'Panel de Carga y Validación de Comprobantes (SAP vs. SUNAT)'
          : 'Carga y Conciliación de Compras (SAP vs. SUNAT)'}
      </h4>
      <p className="text-muted mb-4" style={{ fontSize: '0.86rem' }}>
        {esVentas
          ? 'Cargue los archivos TXT exportados de SAP y SUNAT del período a conciliar y, opcionalmente, el archivo Excel de cortesías.'
          : 'Cargue los archivos TXT exportados de SAP y SUNAT del mismo período contable y, opcionalmente, el Excel de usuarios SAP (también puede subirlo luego desde la tabla de Conciliación). La conciliación se realiza por RUC + Tipo de documento + Serie + Correlativo.'}
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
                  key={load.id || index}
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
              {showPeriodSuggestions && recentLoads.length > 0 && (() => {
                const filteredPeriods = Array.from(new Set(recentLoads.map((l) => l.periodo)))
                  .filter((p) => p.includes(periodo))
                  .slice(0, 5);
                if (filteredPeriods.length === 0) return null;
                return (
                  <ul className="dropdown-premium-menu show w-100" style={{ left: 0, marginTop: '4px' }}>
                    {filteredPeriods.map((p) => (
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
              })()}
            </div>
            <small className="text-muted d-block mt-1" style={{ fontSize: '0.72rem' }}>
              Formato: AAAAMM (se detecta automáticamente al cargar el TXT)
            </small>
          </div>

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
              {showDiaSuggestions && recentLoads.length > 0 && (() => {
                const filteredDays = Array.from(new Set(recentLoads.map((l) => l.dia).filter(Boolean)))
                  .filter((d) => d.includes(dia))
                  .slice(0, 5);
                if (filteredDays.length === 0) return null;
                return (
                  <ul className="dropdown-premium-menu show w-100" style={{ left: 0, marginTop: '4px' }}>
                    {filteredDays.map((d) => (
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
              })()}
            </div>
            <small className="text-muted d-block mt-1" style={{ fontSize: '0.72rem' }}>Día del mes (1-31)</small>
          </div>

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
              {showVersionSuggestions && recentLoads.length > 0 && (() => {
                const filteredVersions = Array.from(new Set(recentLoads.map((l) => String(l.version || 1))))
                  .filter((v) => v.includes(version))
                  .slice(0, 5);
                if (filteredVersions.length === 0) return null;
                return (
                  <ul className="dropdown-premium-menu show w-100" style={{ left: 0, marginTop: '4px' }}>
                    {filteredVersions.map((v) => (
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
              })()}
            </div>
            <small className="text-muted d-block mt-1" style={{ fontSize: '0.72rem' }}>Versión de carga para el día</small>
          </div>
        </div>

        {esVentas ? (
          <div className="row g-3 mb-4">
            {renderTarjetaArchivo({
              tipo: 'sap',
              inputId: 'input-sap',
              accept: '.txt',
              titulo: '1. Archivo SAP',
              subtitulo: 'Archivo TXT exportado de SAP (1111)',
              obligatorio: true,
              file: sapFile,
              lectura: lecturaSap,
              colClass: 'col-lg-4 col-md-6',
            })}
            {renderTarjetaArchivo({
              tipo: 'sunat',
              inputId: 'input-sunat',
              accept: '.txt',
              titulo: '2. Archivo SUNAT',
              subtitulo: 'Archivo TXT exportado de SUNAT (EXP2)',
              obligatorio: true,
              file: sunatFile,
              lectura: lecturaSunat,
              colClass: 'col-lg-4 col-md-6',
            })}
            {renderTarjetaArchivo({
              tipo: 'cortesias',
              inputId: 'input-cortesias',
              accept: '.xlsx,.xls',
              titulo: '3. Archivo de cortesías (opcional)',
              subtitulo: 'Archivo Excel de cortesías',
              obligatorio: false,
              file: cortesiasFile,
              lectura: lecturaCortesias,
              colClass: 'col-lg-4 col-md-6',
            })}
          </div>
        ) : (
          <div className="row g-3 mb-4">
            {renderTarjetaArchivo({
              tipo: 'sap',
              inputId: 'input-sap',
              accept: '.txt',
              titulo: '1. Archivo TXT de SAP (Compras)',
              subtitulo: 'Reporte TXT exportado de SAP (PLE 8.1)',
              obligatorio: true,
              file: sapFile,
              lectura: lecturaSap,
              colClass: 'col-lg-4 col-md-6',
            })}
            {renderTarjetaArchivo({
              tipo: 'sunat',
              inputId: 'input-sunat',
              accept: '.txt',
              titulo: '2. Archivo TXT de SUNAT (Compras)',
              subtitulo: 'Reporte TXT exportado de SUNAT (SIRE RCE)',
              obligatorio: true,
              file: sunatFile,
              lectura: lecturaSunat,
              colClass: 'col-lg-4 col-md-6',
            })}
            {renderTarjetaArchivo({
              tipo: 'usuariosSap',
              inputId: 'input-usuarios-sap',
              accept: '.xlsx,.xls',
              titulo: '3. Usuarios SAP (opcional)',
              subtitulo: 'Excel SAP (Nº documento y Nombre del usuario)',
              obligatorio: false,
              file: usuariosSapFile,
              lectura: lecturaUsuariosSap,
              colClass: 'col-lg-4 col-md-6',
            })}
          </div>
        )}

        {loading && (
          <div className={`upload-wave-box mb-3 animate-fade-in ${esVentas ? '' : 'upload-wave-box--compras'}`}>
            <div className="upload-wave-header">
              <span className="upload-wave-status">
                <span className="upload-wave-dot" aria-hidden="true" />
                <span className="text-truncate">{statusText}</span>
              </span>
              <span className="upload-wave-pct font-mono">{progressPct}%</span>
            </div>

            <div
              className="upload-wave-track"
              role="progressbar"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={statusText || 'Progreso de carga'}
            >
              <div className="upload-wave-rail" aria-hidden="true" />

              <div className="upload-wave-fill" style={{ width: `${progressPct}%` }}>
                <svg className="upload-wave-svg upload-wave-svg--echo" aria-hidden="true">
                  <defs>
                    <pattern id="upload-wave-echo-pat" width="48" height="22" patternUnits="userSpaceOnUse">
                      <path
                        d="M 0 11 Q 12 3, 24 11 T 48 11"
                        fill="none"
                        stroke={esVentas ? '#0EA5E9' : '#3B82F6'}
                        strokeWidth="3.5"
                        strokeLinecap="round"
                      />
                    </pattern>
                  </defs>
                  <rect width="100%" height="22" fill="url(#upload-wave-echo-pat)" />
                </svg>

                <svg className="upload-wave-svg upload-wave-svg--primary" aria-hidden="true">
                  <defs>
                    <pattern id="upload-wave-main-pat" width="48" height="22" patternUnits="userSpaceOnUse">
                      <path
                        d="M 0 11 Q 12 3, 24 11 T 48 11"
                        fill="none"
                        stroke={esVentas ? '#2563EB' : '#7C3AED'}
                        strokeWidth="4.5"
                        strokeLinecap="round"
                      />
                    </pattern>
                  </defs>
                  <rect width="100%" height="22" fill="url(#upload-wave-main-pat)" />
                </svg>
              </div>

              {progressPct > 0 && progressPct < 100 && (
                <div className="upload-wave-tip" style={{ left: `${progressPct}%` }} aria-hidden="true" />
              )}
            </div>
          </div>
        )}

        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
          <span className="text-muted" style={{ fontSize: '0.85rem' }}>
            {!loading && (
              <span className="d-flex align-items-center gap-1">
                <FiFileText /> Los archivos originales no se modifican. El botón se habilita al cargar los dos TXT obligatorios (SAP y SUNAT).
              </span>
            )}
          </span>
          <button
            type="submit"
            disabled={!botonHabilitado}
            className="btn btn-primary d-flex align-items-center px-4 py-2 rounded-3 fw-bold"
            style={{ cursor: botonHabilitado ? 'pointer' : 'not-allowed' }}
          >
            <FiPlay className="me-2" /> {esVentas ? 'PROCESAR VALIDACIÓN' : 'PROCESAR Y CONCILIAR COMPRAS'}
          </button>
        </div>
      </form>
    </div>
  );
});

export default CargaArchivos;
