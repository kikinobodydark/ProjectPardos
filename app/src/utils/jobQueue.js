// ============================================================================
// Cola de Trabajo Asíncrona (Background Job Queue) y Despachador de Web Workers
// - Divide tareas pesadas (parseo de archivos de hasta 15 MB, conciliación de
//   3 vías, exportación Excel, inserciones y revalidaciones masivas) en
//   Web Workers o lotes concurrentes sin bloquear el hilo principal (UI)
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

// Instancia singleton de Web Worker con fallback transparente para Node / SSR
let sharedWorker = null;
let workerReqId = 0;
const pendingWorkerCallbacks = new Map();

function getOrCreateWorker() {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    return null;
  }
  if (sharedWorker) return sharedWorker;

  try {
    sharedWorker = new Worker(new URL('../workers/reconciliationWorker.js', import.meta.url), {
      type: 'module',
    });
    sharedWorker.onmessage = (event) => {
      const { id, ok, result, error } = event.data || {};
      const pending = pendingWorkerCallbacks.get(id);
      if (!pending) return;
      pendingWorkerCallbacks.delete(id);
      if (ok) pending.resolve(result);
      else pending.reject(new Error(error || 'Error en Web Worker de conciliación'));
    };
    sharedWorker.onerror = (err) => {
      // Si el worker falla al cargar, rechazar pendientes y desactivar worker
      for (const [, p] of pendingWorkerCallbacks.entries()) {
        p.reject(err);
      }
      pendingWorkerCallbacks.clear();
      sharedWorker = null;
    };
    return sharedWorker;
  } catch {
    return null;
  }
}

/**
 * Ejecuta una tarea de CPU intensiva en el Web Worker o en la cola asíncrona
 * cediendo el hilo principal (`setTimeout(0)`) si Worker no está disponible.
 */
export async function runCpuTaskInWorker(action, payload) {
  return traceAsync(`Worker:${action}`, async () => {
    const worker = getOrCreateWorker();
    if (worker) {
      const id = ++workerReqId;
      return new Promise((resolve, reject) => {
        pendingWorkerCallbacks.set(id, { resolve, reject });
        worker.postMessage({ id, action, payload });
      });
    }

    // Fallback asíncrono no bloqueante (Node.js / tests / navegadores sin module worker)
    await new Promise((r) => setTimeout(r, 0));
    return executeCpuTaskFallback(action, payload);
  });
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
