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
import { parsearSapCompras, parsearSunatCompras, parsearUsuariosSapCompras } from './compras/lectores.js';
import { conciliarCompras } from './compras/motor.js';
import { aFilaBDCompras } from './compras/persistencia.js';

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

function createWorkerSlot(index) {
  const w = new Worker(new URL('../workers/reconciliationWorker.js', import.meta.url), {
    type: 'module',
  });
  const slot = { worker: w, busyCount: 0, index, pendingIds: new Set() };
  w.onmessage = (event) => {
    slot.busyCount = Math.max(0, slot.busyCount - 1);
    const { id, ok, result, error } = event.data || {};
    slot.pendingIds.delete(id);
    const pending = pendingWorkerCallbacks.get(id);
    if (!pending) return;
    pendingWorkerCallbacks.delete(id);
    if (ok) pending.resolve(result);
    else pending.reject(new Error(error || 'Error en Web Worker de conciliación'));
  };
  w.onerror = (err) => {
    slot.busyCount = 0;
    // Aislar el fallo únicamente a las promesas pendientes de este worker
    for (const id of slot.pendingIds) {
      const pending = pendingWorkerCallbacks.get(id);
      if (pending) {
        pendingWorkerCallbacks.delete(id);
        pending.reject(err instanceof Error ? err : new Error(err?.message || 'Fallo inesperado en Web Worker'));
      }
    }
    slot.pendingIds.clear();
    try {
      w.terminate();
    } catch {
      // ignore terminate error
    }
    // Reemplazar automáticamente el slot caído sin inhabilitar el resto del pool
    try {
      workerPool[index] = createWorkerSlot(index);
    } catch {
      workerPool[index] = null;
    }
  };
  return slot;
}

function initWorkerPool() {
  if (typeof window === 'undefined' || typeof Worker === 'undefined' || workerPoolFailed) {
    return false;
  }
  if (workerPoolInitialized && workerPool.some(Boolean)) {
    return true;
  }
  try {
    workerPool.length = 0;
    for (let i = 0; i < WORKER_POOL_SIZE; i++) {
      workerPool.push(createWorkerSlot(i));
    }
    workerPoolInitialized = true;
    return true;
  } catch {
    workerPoolFailed = true;
    return false;
  }
}

function pickLeastBusyWorker() {
  if (!initWorkerPool()) return null;
  let best = null;
  for (let i = 0; i < workerPool.length; i++) {
    const slot = workerPool[i];
    if (!slot) continue;
    if (!best || slot.busyCount < best.busyCount) {
      best = slot;
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
      slot.pendingIds.add(id);
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

/**
 * Divide la serialización de documentos conciliados de Compras (`aFilaBDCompras`)
 * entre el Pool de Web Workers en paralelo.
 */
export async function serializeComprasDocsInWorkerPool(docs, metaBD, batchSize = 1500) {
  if (!docs || docs.length === 0) return [];
  const chunks = [];
  for (let i = 0; i < docs.length; i += batchSize) {
    chunks.push(docs.slice(i, i + batchSize));
  }

  return Promise.all(
    chunks.map((docsChunk) =>
      runCpuTaskInWorker('SERIALIZE_FILAS_COMPRAS', { docsChunk, metaBD })
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
    case 'PARSE_SAP_COMPRAS': {
      const { texto, codificacion } = decodificarTexto(payload.buffer);
      const res = parsearSapCompras(texto);
      res.codificacion = codificacion;
      return res;
    }
    case 'PARSE_SUNAT_COMPRAS': {
      const { texto, codificacion } = decodificarTexto(payload.buffer);
      const res = parsearSunatCompras(texto);
      res.codificacion = codificacion;
      return res;
    }
    case 'PARSE_USUARIOS_SAP_COMPRAS': {
      return parsearUsuariosSapCompras(payload.filas);
    }
    case 'CONCILIAR_COMPRAS_V2': {
      const { sap, sunat, usuariosSap = null, metaBD } = payload;
      const resultado = conciliarCompras({ sap, sunat, usuariosSap });
      if (metaBD) {
        resultado.filasParaInsertar = resultado.docs.map((d) => aFilaBDCompras(d, metaBD));
      }
      return resultado;
    }
    case 'SERIALIZE_FILAS_COMPRAS': {
      const { docsChunk, metaBD } = payload;
      return docsChunk.map((d) => aFilaBDCompras(d, metaBD));
    }
    default:
      throw new Error(`Acción de worker desconocida: ${action}`);
  }
}
