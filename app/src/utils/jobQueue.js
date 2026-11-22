// ============================================================================
// Pool de Web Workers Paralelos (Multi-Worker Pool) y Cola de Trabajo Asíncrona
// - Mantiene un pool de hasta 4 Web Workers (según `navigator.hardwareConcurrency`)
// - Permite parsear múltiples archivos simultáneamente en hilos separados y
//   dividir la serialización de miles de filas (`SERIALIZE_FILAS_VENTAS`) entre
//   varios workers en paralelo.
// ============================================================================
import { traceAsync } from './telemetry.js';
import { decodificarTexto, parsearSapVentas, parsearSunatVentas, parsearCortesias } from './ventas/lectores.js';
import { conciliarVentas } from './ventas/motor.js';
import { aFilaBD } from './ventas/persistencia.js';
import { parseSIRE, stripBOM, parseSAPCompras, parseSUNATCompras } from './parsers.js';
import { reconcileData } from './validations.js';

export class JobQueue {
  constructor({ concurrency = 4 } = {}) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
    this.completedJobs = 0;
  }

  setConcurrency(c) {
    if (typeof c === 'number' && c >= 1) {
      this.concurrency = c;
    }
  }

  enqueue(taskName, taskFn, { priority = 0 } = {}) {
    return new Promise((resolve, reject) => {
      this.queue.push({ taskName, taskFn, priority, resolve, reject });
      this.queue.sort((a, b) => b.priority - a.priority);
      this._drain();
    });
  }

  _drain() {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift();
      this.running += 1;
      traceAsync(`JobQueue:${job.taskName}`, () => Promise.resolve().then(job.taskFn))
        .then((res) => {
          this.completedJobs += 1;
          job.resolve(res);
        })
        .catch((err) => {
          job.reject(err);
        })
        .finally(() => {
          this.running -= 1;
          this._drain();
        });
    }
  }
}

export const globalJobQueue = new JobQueue({ concurrency: 4 });

/**
 * Ejecuta una lista de lotes (chunks) en paralelo controlado a través de la cola
 * de trabajo, reportando progreso tras cada lote completado.
 */
export async function executeParallelBatches(items, batchSize, workerFn, { concurrency = 4, onProgress, label = 'BatchJob' } = {}) {
  if (!items || items.length === 0) return [];
  const chunks = [];
  for (let i = 0; i < items.length; i += batchSize) {
    chunks.push({ index: chunks.length, slice: items.slice(i, i + batchSize) });
  }

  const queue = new JobQueue({ concurrency });
  let processedItems = 0;

  const promises = chunks.map((chunk) =>
    queue.enqueue(`${label}#${chunk.index + 1}`, async () => {
      const res = await workerFn(chunk.slice, chunk.index);
      processedItems += chunk.slice.length;
      if (onProgress) {
        onProgress(processedItems, items.length);
      }
      return res;
    })
  );

  return Promise.all(promises);
}

// ============================================================================
// Pool de Web Workers (hasta 4 hilos en paralelo)
// ============================================================================
const WORKER_POOL_SIZE =
  typeof navigator !== 'undefined' && navigator.hardwareConcurrency
    ? Math.min(4, Math.max(2, navigator.hardwareConcurrency))
    : 4;

const workerPool = [];
let workerPoolInitialized = false;
let workerPoolFailed = false;
let workerReqId = 0;
const pendingWorkerCallbacks = new Map();

function initWorkerPool() {
  if (typeof window === 'undefined' || typeof Worker === 'undefined' || workerPoolFailed) {
    return false;
  }
  if (workerPoolInitialized && workerPool.length > 0) {
    return true;
  }
  try {
    for (let i = 0; i < WORKER_POOL_SIZE; i++) {
      const w = new Worker(new URL('../workers/reconciliationWorker.js', import.meta.url), {
        type: 'module',
      });
      const slot = { worker: w, busyCount: 0, index: i };
      w.onmessage = (event) => {
        slot.busyCount = Math.max(0, slot.busyCount - 1);
        const { id, ok, result, error } = event.data || {};
        const pending = pendingWorkerCallbacks.get(id);
        if (!pending) return;
        pendingWorkerCallbacks.delete(id);
        if (ok) pending.resolve(result);
        else pending.reject(new Error(error || 'Error en Web Worker de conciliación'));
      };
      w.onerror = (err) => {
        slot.busyCount = 0;
        for (const [, p] of pendingWorkerCallbacks.entries()) {
          p.reject(err);
        }
        pendingWorkerCallbacks.clear();
        workerPoolFailed = true;
      };
      workerPool.push(slot);
    }
    workerPoolInitialized = true;
    return true;
  } catch {
    workerPoolFailed = true;
    return false;
  }
}

function pickLeastBusyWorker() {
  if (!initWorkerPool() || workerPool.length === 0) return null;
  let best = workerPool[0];
  for (let i = 1; i < workerPool.length; i++) {
    if (workerPool[i].busyCount < best.busyCount) {
      best = workerPool[i];
    }
  }
  return best;
}

/**
 * Despacha una tarea al Web Worker con menor carga del Pool (soporta Transferables).
 */
export async function runCpuTaskInWorker(action, payload, transferList = []) {
  return traceAsync(`WorkerPool:${action}`, async () => {
    const slot = pickLeastBusyWorker();
    if (slot) {
      const id = ++workerReqId;
      slot.busyCount += 1;
      return new Promise((resolve, reject) => {
        pendingWorkerCallbacks.set(id, { resolve, reject });
        try {
          if (transferList && transferList.length > 0) {
            slot.worker.postMessage({ id, action, payload }, transferList);
          } else {
            slot.worker.postMessage({ id, action, payload });
          }
        } catch {
          slot.worker.postMessage({ id, action, payload });
        }
      });
    }

    await new Promise((r) => setTimeout(r, 0));
    return executeCpuTaskFallback(action, payload);
  });
}

/**
 * Divide la serialización de miles de documentos (`aFilaBD`) en varios Workers
 * en paralelo para preparar los lotes listos para insertar en Supabase.
 */
export async function serializeDocsInWorkerPool(docs, metaBD, batchSize = 1500) {
  if (!docs || docs.length === 0) return [];
  const chunks = [];
  for (let i = 0; i < docs.length; i += batchSize) {
    chunks.push(docs.slice(i, i + batchSize));
  }

  return Promise.all(
    chunks.map((docsChunk) =>
      runCpuTaskInWorker('SERIALIZE_FILAS_VENTAS', { docsChunk, metaBD })
    )
  );
}

export function executeCpuTaskFallback(action, payload) {
  switch (action) {
    case 'PARSE_SAP_VENTAS': {
      const { texto, codificacion } = decodificarTexto(payload.buffer);
      const res = parsearSapVentas(texto);
      res.codificacion = codificacion;
      return res;
    }
    case 'PARSE_SUNAT_VENTAS': {
      const { texto, codificacion } = decodificarTexto(payload.buffer);
      const res = parsearSunatVentas(texto);
      res.codificacion = codificacion;
      return res;
    }
    case 'PARSE_CORTESIAS': {
      return parsearCortesias(payload.filas);
    }
    case 'CONCILIAR_VENTAS': {
      const { sap, sunat, cortesias, metaBD } = payload;
      const resultado = conciliarVentas({ sap, sunat, cortesias });
      if (metaBD) {
        resultado.filasParaInsertar = resultado.docs.map((d) => aFilaBD(d, metaBD));
      }
      return resultado;
    }
    case 'SERIALIZE_FILAS_VENTAS': {
      const { docsChunk, metaBD } = payload;
      return docsChunk.map((d) => aFilaBD(d, metaBD));
    }
    case 'PARSE_SINGLE_COMPRAS': {
      const { tipo, buffer } = payload;
      if (tipo === 'sunat') {
        const sunatText = stripBOM(new TextDecoder('utf-8').decode(buffer));
        return parseSUNATCompras(sunatText);
      }
      if (tipo === 'sap') {
        const sapText = new TextDecoder('windows-1252').decode(buffer);
        return parseSAPCompras(sapText);
      }
      if (tipo === 'sire') {
        const sireText = new TextDecoder('windows-1252').decode(buffer);
        return parseSIRE(sireText);
      }
      throw new Error(`Tipo de archivo de compras desconocido: ${tipo}`);
    }
    case 'CONCILIAR_COMPRAS_PARSED': {
      const { sapData, sunatData, sireData, rucEmpresa, modulo, periodId, empresaId } = payload;
      const reconciledList = reconcileData(sapData, sunatData, sireData, rucEmpresa, [], modulo);
      const mappedRows = reconciledList.map((r) => ({
        periodo_id: periodId,
        empresa_id: empresaId,
        car_sunat: r.car_sunat,
        ruc_proveedor: r.ruc_proveedor,
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
        errores_json: r.errores_json,
      }));
      return { totalCount: reconciledList.length, mappedRows };
    }
    case 'CONCILIAR_COMPRAS': {
      const { sunatBuffer, sapBuffer, sireBuffer, rucEmpresa, modulo } = payload;
      const sunatText = stripBOM(new TextDecoder('utf-8').decode(sunatBuffer));
      const sapText = new TextDecoder('windows-1252').decode(sapBuffer);
      const sireText = new TextDecoder('windows-1252').decode(sireBuffer);

      const sunatData = parseSUNATCompras(sunatText);
      const sapData = parseSAPCompras(sapText);
      const sireData = parseSIRE(sireText);

      if (sunatData.length === 0) throw new Error('El archivo de SUNAT está vacío o no coincide con el formato.');
      if (sapData.length === 0) throw new Error('El archivo de SAP está vacío o no coincide con el formato.');
      if (sireData.length === 0) throw new Error('El archivo de SIRE está vacío o no coincide con el formato.');

      const reconciledList = reconcileData(sapData, sunatData, sireData, rucEmpresa, [], modulo);
      return { reconciledList };
    }
    default:
      throw new Error(`Acción de worker desconocida: ${action}`);
  }
}
