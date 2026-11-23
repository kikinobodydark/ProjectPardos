// ============================================================================
// OpenTelemetry-Compatible Tracing & Slow-Request Monitor (W3C Trace Context)
// - Inyecta cabeceras W3C `traceparent` (00-<traceId>-<spanId>-01)
// - Rastrea automáticamente peticiones a Supabase, tareas de Workers y UI
// - Detecta y registra peticiones lentas (> umbral configurable, 500ms default)
// - Deduplica peticiones GET/HEAD concurrentes idénticas en vuelo (In-Flight Deduplication)
// ============================================================================

const MAX_SPANS_BUFFER = 150;
const DEFAULT_SLOW_THRESHOLD_MS = 500;

const spansBuffer = [];
const slowRequestsBuffer = [];
const listeners = new Set();
const inFlightGetRequests = new Map();

let slowThresholdMs = DEFAULT_SLOW_THRESHOLD_MS;

function randomHex(bytesCount) {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint8Array(bytesCount);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  let out = '';
  for (let i = 0; i < bytesCount * 2; i++) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

export function generateTraceId() {
  return randomHex(16); // 32 hex chars (128-bit)
}

export function generateSpanId() {
  return randomHex(8); // 16 hex chars (64-bit)
}

export function buildTraceparent(traceId = generateTraceId(), spanId = generateSpanId(), sampled = true) {
  return `00-${traceId}-${spanId}-${sampled ? '01' : '00'}`;
}

export function setSlowRequestThreshold(ms) {
  if (typeof ms === 'number' && ms > 0) {
    slowThresholdMs = ms;
  }
}

function notifyListeners() {
  const summary = getTelemetrySummary();
  listeners.forEach((fn) => {
    try {
      fn(summary);
    } catch {
      // ignore listener errors
    }
  });
}

export function subscribeTelemetry(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Inicia un span compatible con OpenTelemetry.
 */
export function startSpan(name, attributes = {}) {
  const traceId = attributes.traceId || generateTraceId();
  const spanId = generateSpanId();
  const traceparent = buildTraceparent(traceId, spanId, true);
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const startWall = new Date().toISOString();

  return {
    name,
    traceId,
    spanId,
    traceparent,
    attributes: { ...attributes },
    startTime,
    end(extraAttributes = {}) {
      const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const durationMs = extraAttributes.durationOverride ?? Number((endTime - startTime).toFixed(2));
      const threshold = extraAttributes.thresholdMs ?? slowThresholdMs;
      const isSlow = durationMs >= threshold;

      const record = {
        name,
        traceId,
        spanId,
        traceparent,
        startWall,
        durationMs,
        isSlow,
        status: extraAttributes.status || 'OK',
        attributes: { ...attributes, ...extraAttributes },
      };

      spansBuffer.unshift(record);
      if (spansBuffer.length > MAX_SPANS_BUFFER) spansBuffer.pop();

      if (isSlow) {
        slowRequestsBuffer.unshift(record);
        if (slowRequestsBuffer.length > 50) slowRequestsBuffer.pop();
      }

      notifyListeners();
      return record;
    },
  };
}

/**
 * Envuelve una promesa o función asíncrona en un span de OpenTelemetry.
 */
export async function traceAsync(name, fn, attributes = {}) {
  const span = startSpan(name, attributes);
  try {
    const result = await fn(span);
    span.end({ status: 'OK' });
    return result;
  } catch (err) {
    span.end({ status: 'ERROR', error: err?.message || String(err) });
    throw err;
  }
}

/**
 * Resumen actual de métricas de telemetría.
 */
export function getTelemetrySummary() {
  const totalSpans = spansBuffer.length;
  const slowCount = slowRequestsBuffer.length;
  const avgDurationMs =
    totalSpans > 0
      ? Number((spansBuffer.reduce((acc, s) => acc + s.durationMs, 0) / totalSpans).toFixed(1))
      : 0;
  const maxDurationMs =
    totalSpans > 0
      ? Number(Math.max(...spansBuffer.map((s) => s.durationMs)).toFixed(1))
      : 0;

  return {
    totalSpans,
    slowCount,
    avgDurationMs,
    maxDurationMs,
    slowThresholdMs,
    recentSpans: spansBuffer.slice(0, 20),
    slowRequests: slowRequestsBuffer.slice(0, 15),
    deduplicatedCount: statsCounters.deduplicated,
    pooledCount: statsCounters.pooled,
    balancedInstances: { ...statsCounters.instances },
  };
}

export const statsCounters = {
  deduplicated: 0,
  pooled: 0,
  instances: {},
};

export function clearTelemetry() {
  spansBuffer.length = 0;
  slowRequestsBuffer.length = 0;
  statsCounters.deduplicated = 0;
  statsCounters.pooled = 0;
  notifyListeners();
}

/**
 * Deduplicador de llamadas HTTP GET/HEAD idénticas en vuelo + trazado OpenTelemetry.
 * Si dos componentes lanzan exactamente la misma consulta simultáneamente,
 * comparten la misma promesa y se clona la respuesta HTTP sin duplicar tráfico.
 */
export function createInstrumentedFetch({
  baseFetch = typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null,
  maxConcurrent = 6,
  readUrls = [],
  primaryUrl = '',
} = {}) {
  let activeRequests = 0;
  const waitQueue = [];
  let roundRobinIndex = 0;
  const unhealthyUrls = new Map(); // url -> timestamp

  const acquireSlot = () => {
    if (activeRequests < maxConcurrent) {
      activeRequests += 1;
      statsCounters.pooled += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      waitQueue.push(resolve);
    });
  };

  const releaseSlot = () => {
    if (waitQueue.length > 0) {
      const next = waitQueue.shift();
      statsCounters.pooled += 1;
      next();
    } else {
      activeRequests = Math.max(0, activeRequests - 1);
    }
  };

  /**
   * Reparto de tráfico (Load Balancing Round-Robin con Failover) para lecturas REST.
   */
  const selectTargetUrl = (rawUrl, method) => {
    const isRead = method === 'GET' || method === 'HEAD';
    if (!isRead || !readUrls || readUrls.length <= 1 || !primaryUrl) {
      const hostKey = primaryUrl || 'primary';
      statsCounters.instances[hostKey] = (statsCounters.instances[hostKey] || 0) + 1;
      return { finalUrl: rawUrl, instance: hostKey };
    }

    // No balancear endpoints de Auth; solo lecturas de datos REST (/rest/v1/)
    if (!rawUrl.includes('/rest/v1/')) {
      statsCounters.instances[primaryUrl] = (statsCounters.instances[primaryUrl] || 0) + 1;
      return { finalUrl: rawUrl, instance: primaryUrl };
    }

    const now = Date.now();
    const healthyPool = readUrls.filter((u) => {
      const markedAt = unhealthyUrls.get(u);
      if (!markedAt) return true;
      if (now - markedAt > 30000) {
        unhealthyUrls.delete(u);
        return true;
      }
      return false;
    });

    const pool = healthyPool.length > 0 ? healthyPool : [primaryUrl];
    const chosenBase = pool[roundRobinIndex % pool.length];
    roundRobinIndex = (roundRobinIndex + 1) % pool.length;

    statsCounters.instances[chosenBase] = (statsCounters.instances[chosenBase] || 0) + 1;
    const finalUrl = rawUrl.startsWith(primaryUrl)
      ? chosenBase.replace(/\/$/, '') + rawUrl.slice(primaryUrl.replace(/\/$/, '').length)
      : rawUrl;

    return { finalUrl, instance: chosenBase };
  };

  return async function instrumentedFetch(input, init = {}) {
    if (!baseFetch) {
      throw new Error('Fetch API no disponible en este entorno.');
    }

    const rawUrl = typeof input === 'string' ? input : input?.url || String(input);
    const method = (init?.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();

    // Clave de deduplicación para peticiones GET/HEAD idénticas en vuelo
    const isDeduplicable = method === 'GET' || method === 'HEAD';
    const reqHeaders = new Headers(
      init?.headers || (typeof input === 'object' ? input?.headers : undefined) || {}
    );
    const authHeader = reqHeaders.get('Authorization') || '';
    const rangeHeader = reqHeaders.get('Range') || '';
    const preferHeader = reqHeaders.get('Prefer') || '';
    const dedupKey = isDeduplicable
      ? `${method}:${rawUrl}:${rangeHeader}:${preferHeader}:${authHeader.slice(-16)}`
      : null;

    if (dedupKey && inFlightGetRequests.has(dedupKey)) {
      statsCounters.deduplicated += 1;
      const sharedResponse = await inFlightGetRequests.get(dedupKey);
      return sharedResponse.clone();
    }

    const executeRequest = async () => {
      await acquireSlot();
      const { finalUrl, instance } = selectTargetUrl(rawUrl, method);
      const shortPath = finalUrl.replace(/^https?:\/\/[^/]+/, '').split('?')[0] || finalUrl;
      const span = startSpan(`HTTP ${method} ${shortPath}`, {
        'http.method': method,
        'http.url': shortPath,
        'net.instance': instance,
        'pool.active': activeRequests,
      });

      const headers = new Headers(init?.headers || (typeof input === 'object' ? input?.headers : undefined) || {});
      headers.set('traceparent', span.traceparent);

      try {
        const response = await baseFetch(finalUrl, {
          ...init,
          headers,
          keepalive: method !== 'POST' || finalUrl.includes('rpc'),
        });
        span.end({
          status: response.ok ? 'OK' : 'HTTP_ERROR',
          'http.status_code': response.status,
        });
        return response;
      } catch (err) {
        if (instance !== primaryUrl && primaryUrl && rawUrl.startsWith(primaryUrl)) {
          // Marcar réplica como no saludable temporalmente y hacer failover a la instancia primaria
          unhealthyUrls.set(instance, Date.now());
          const fallbackResponse = await baseFetch(rawUrl, { ...init, headers });
          span.end({
            status: 'FAILOVER_OK',
            'http.status_code': fallbackResponse.status,
            'net.failover': true,
          });
          return fallbackResponse;
        }
        span.end({ status: 'NETWORK_ERROR', error: err?.message || String(err) });
        throw err;
      } finally {
        releaseSlot();
      }
    };

    if (!dedupKey) {
      return executeRequest();
    }

    const promise = executeRequest().finally(() => {
      inFlightGetRequests.delete(dedupKey);
    });

    inFlightGetRequests.set(dedupKey, promise);
    const res = await promise;
    return res.clone();
  };
}

/**
 * Inicializa observadores de rendimiento del navegador (Long Tasks y Paint).
 */
export function initWebVitalsObserver() {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;
  try {
    const supported = PerformanceObserver.supportedEntryTypes || [];
    if (supported.includes('longtask')) {
      const longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > 100) {
            const span = startSpan('UI LongTask', { entryType: 'longtask' });
            span.end({
              durationOverride: entry.duration,
              status: 'SLOW_UI_TASK',
              durationMs: Number(entry.duration.toFixed(1)),
            });
          }
        }
      });
      longTaskObserver.observe({ type: 'longtask', buffered: true });
    }
  } catch {
    // Ignorar en navegadores que no soporten longtask
  }
}
