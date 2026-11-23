// ============================================================================
// Gestor Persistente de Sincronización en Segundo Plano y Streaming Progresivo
// - Mantiene una descarga única (single-flight) por `(modulo, periodId)` que NO
//   se cancela al cambiar de pestaña (Dashboard <-> Conciliación <-> Historial).
// - Solo aborta cuando cambia el período, la empresa, el módulo o la sesión.
// - Hidrata lotes de forma incremental (`partialDocs`) ÚNICAMENTE cuando una
//   vista de Conciliación está suscrita esperando resultados preliminares,
//   evitando gastar CPU mientras el usuario revisa el Dashboard.
// ============================================================================
import { useState, useEffect } from 'react';
import { runCpuTaskInWorker } from './jobQueue.js';

const inFlightJobs = new Map();
const progressMap = new Map();
const partialDocsMap = new Map();

const progressListeners = new Set();
const partialListenersByKey = new Map();

export function makeSyncKey(modulo, periodId) {
  return `${modulo === 'compras' ? 'compras' : 'ventas'}:${periodId || ''}`;
}

function notifyProgress(key, state) {
  if (state) {
    progressMap.set(key, state);
  } else {
    progressMap.delete(key);
  }
  progressListeners.forEach((fn) => {
    try {
      fn(key, state);
    } catch {
      // ignore listener errors
    }
  });
}

function notifyPartial(key, docs) {
  if (docs && docs.length > 0) {
    partialDocsMap.set(key, docs);
  } else {
    partialDocsMap.delete(key);
  }
  const listeners = partialListenersByKey.get(key);
  if (!listeners) return;
  listeners.forEach((fn) => {
    try {
      fn(docs || []);
    } catch {
      // ignore listener errors
    }
  });
}

function hasPartialSubscribers(key) {
  const listeners = partialListenersByKey.get(key);
  return !!listeners && listeners.size > 0;
}

const PARTIAL_FLUSH_INTERVAL_MS = 450;

async function flushPartialDelta(key, job) {
  if (!job || job.finished || job.controller.signal.aborted) return;
  if (job.hydratingDelta || !hasPartialSubscribers(key)) return;
  if (job.rawRows.length <= job.hydratedCount) return;

  job.hydratingDelta = true;
  try {
    while (
      !job.finished &&
      !job.controller.signal.aborted &&
      hasPartialSubscribers(key) &&
      job.rawRows.length > job.hydratedCount
    ) {
      const start = job.hydratedCount;
      const end = job.rawRows.length;
      const deltaRows = job.rawRows.slice(start, end);
      job.hydratedCount = end;

      const hydratedDelta = await runCpuTaskInWorker(job.batchWorkerAction, { filas: deltaRows });
      if (job.finished || job.controller.signal.aborted) return;

      if (Array.isArray(hydratedDelta) && hydratedDelta.length > 0) {
        job.partialDocs = job.partialDocs.length === 0
          ? hydratedDelta
          : [...job.partialDocs, ...hydratedDelta];
        job.lastDeltaAt = Date.now();
        notifyPartial(key, job.partialDocs);
      }
    }
  } catch {
    // El error de vista preliminar no debe interrumpir la descarga principal
  } finally {
    job.hydratingDelta = false;
  }
}

function schedulePartialFlush(key, job, immediate = false) {
  if (!job || job.finished || job.controller.signal.aborted) return;
  if (!hasPartialSubscribers(key)) return;
  if (job.rawRows.length <= job.hydratedCount) return;

  const now = Date.now();
  const elapsed = now - job.lastDeltaAt;

  if (immediate || job.partialDocs.length === 0 || elapsed >= PARTIAL_FLUSH_INTERVAL_MS) {
    if (job.flushTimer) {
      clearTimeout(job.flushTimer);
      job.flushTimer = null;
    }
    flushPartialDelta(key, job);
    return;
  }

  if (!job.flushTimer) {
    job.flushTimer = setTimeout(() => {
      job.flushTimer = null;
      flushPartialDelta(key, job);
    }, Math.max(50, PARTIAL_FLUSH_INTERVAL_MS - elapsed));
  }
}

export function getSyncProgress(modulo, periodId) {
  if (!periodId) return null;
  return progressMap.get(makeSyncKey(modulo, periodId)) || null;
}

export function getPartialDocs(modulo, periodId) {
  if (!periodId) return [];
  return partialDocsMap.get(makeSyncKey(modulo, periodId)) || [];
}

export function subscribeSyncProgress(modulo, periodId, listener) {
  const targetKey = makeSyncKey(modulo, periodId);
  const wrapped = (key, state) => {
    if (key === targetKey) listener(state);
  };
  progressListeners.add(wrapped);
  return () => {
    progressListeners.delete(wrapped);
  };
}

export function subscribePartialDocs(modulo, periodId, listener) {
  const key = makeSyncKey(modulo, periodId);
  let set = partialListenersByKey.get(key);
  if (!set) {
    set = new Set();
    partialListenersByKey.set(key, set);
  }
  set.add(listener);

  // Si ya hay filas descargadas en segundo plano sin hidratar, disparar vista preliminar de inmediato
  const activeJob = inFlightJobs.get(key);
  if (activeJob && activeJob.rawRows.length > activeJob.hydratedCount) {
    schedulePartialFlush(key, activeJob, true);
  }

  return () => {
    const curr = partialListenersByKey.get(key);
    if (curr) {
      curr.delete(listener);
      if (curr.size === 0) {
        partialListenersByKey.delete(key);
      }
    }
  };
}

/**
 * Cancela descargas activas de períodos distintos al período actualmente seleccionado.
 * Nunca aborta la descarga del período activo (aunque el usuario cambie de pestaña).
 */
export function cancelOtherPeriodSyncs(activeModulo, activePeriodId) {
  const keepKey = activeModulo && activePeriodId ? makeSyncKey(activeModulo, activePeriodId) : null;
  for (const [key, job] of inFlightJobs.entries()) {
    if (key !== keepKey) {
      job.finished = true;
      if (job.flushTimer) clearTimeout(job.flushTimer);
      job.controller.abort();
      inFlightJobs.delete(key);
      notifyProgress(key, null);
      notifyPartial(key, []);
    }
  }
}

export function cancelAllPeriodSyncs() {
  cancelOtherPeriodSyncs(null, null);
}

/**
 * Ejecuta o se une a la descarga single-flight persistente de un período.
 */
export function runOrJoinPeriodSync({ modulo, periodId, batchWorkerAction, executor }) {
  const key = makeSyncKey(modulo, periodId);
  const existing = inFlightJobs.get(key);
  if (existing && !existing.finished && !existing.controller.signal.aborted) {
    return existing.promise;
  }

  const controller = new AbortController();
  const job = {
    key,
    controller,
    batchWorkerAction,
    rawRows: [],
    hydratedCount: 0,
    partialDocs: [],
    hydratingDelta: false,
    lastDeltaAt: 0,
    flushTimer: null,
    finished: false,
    promise: null,
  };

  const emitProgress = (state) => {
    if (!job.finished && !controller.signal.aborted) {
      notifyProgress(key, state);
    }
  };

  const pushRawBatch = (rows) => {
    if (job.finished || controller.signal.aborted || !Array.isArray(rows) || rows.length === 0) {
      return;
    }
    for (let i = 0; i < rows.length; i++) {
      job.rawRows.push(rows[i]);
    }
    if (hasPartialSubscribers(key)) {
      schedulePartialFlush(key, job, job.partialDocs.length === 0);
    }
  };

  const promise = (async () => {
    try {
      const result = await executor({
        signal: controller.signal,
        emitProgress,
        pushRawBatch,
      });
      return result;
    } finally {
      job.finished = true;
      if (job.flushTimer) {
        clearTimeout(job.flushTimer);
        job.flushTimer = null;
      }
      job.rawRows = [];
      job.partialDocs = [];
      if (inFlightJobs.get(key) === job) {
        inFlightJobs.delete(key);
      }
      notifyProgress(key, null);
      notifyPartial(key, []);
    }
  })();

  job.promise = promise;
  inFlightJobs.set(key, job);
  return promise;
}

/** Hook ligero para suscribirse únicamente al progreso global de un período (Sidebar / Navbar / Dashboard). */
export function usePeriodSyncProgress(modulo, periodId) {
  const [progress, setProgress] = useState(() =>
    modulo && periodId ? getSyncProgress(modulo, periodId) : null
  );

  useEffect(() => {
    if (!modulo || !periodId) {
      setProgress(null);
      return undefined;
    }
    setProgress(getSyncProgress(modulo, periodId));
    return subscribeSyncProgress(modulo, periodId, setProgress);
  }, [modulo, periodId]);

  return progress;
}
