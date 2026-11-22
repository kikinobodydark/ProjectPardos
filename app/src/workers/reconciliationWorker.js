// ============================================================================
// Web Worker Dedicado para Parseo y Conciliación Contable (SAP vs SUNAT vs SIRE)
// Ejecuta fuera del hilo principal para mantener 60 FPS en la interfaz.
// ============================================================================
import { executeCpuTaskFallback } from '../utils/jobQueue.js';

self.onmessage = async (event) => {
  const { id, action, payload } = event.data || {};
  try {
    const result = await executeCpuTaskFallback(action, payload);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err?.message || String(err),
    });
  }
};
