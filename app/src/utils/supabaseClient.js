// ============================================================================
// Cliente de Supabase Optimizado con:
// 1. Pool de Conexiones HTTP + Soporte de Supavisor Transaction Pooler (puerto 6543)
// 2. Balanceo de Carga (Round-Robin + Failover) entre múltiples instancias de lectura
// 3. Deduplicación en vuelo (In-Flight Request Deduplication) para llamadas GET/HEAD
// 4. Trazabilidad OpenTelemetry (W3C traceparent) y detección de consultas lentas
// 5. Pre-conexión DNS/TLS temprana para minimizar latencia hacia la base de datos
// ============================================================================
import { createClient } from '@supabase/supabase-js';
import { getOrCreateCsrfToken } from './security';
import { createInstrumentedFetch } from './telemetry';

const supabaseUrl =
  (typeof import.meta !== 'undefined' && (import.meta.env?.VITE_SUPABASE_POOLER_URL || import.meta.env?.VITE_SUPABASE_URL)) ||
  'https://placeholder.supabase.co';
const supabaseAnonKey =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) ||
  'public-anon-key-placeholder';

// Lista opcional de instancias/réplicas de lectura separadas por coma para repartir el tráfico
const rawReadUrls = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_READ_URLS) || '';
const readReplicaUrls = rawReadUrls
  ? rawReadUrls
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean)
  : [supabaseUrl];

if (
  typeof import.meta !== 'undefined' &&
  (!import.meta.env?.VITE_SUPABASE_URL || !import.meta.env?.VITE_SUPABASE_ANON_KEY)
) {
  if (import.meta.env?.DEV) {
    console.error('Faltan variables de entorno de Supabase. Revisa .env.local');
  }
}

// Validar que en producción la URL de Supabase utilice obligatoriamente HTTPS
if (
  supabaseUrl &&
  typeof import.meta !== 'undefined' &&
  import.meta.env?.PROD &&
  !supabaseUrl.startsWith('https://')
) {
  throw new Error('Configuración insegura: VITE_SUPABASE_URL debe utilizar HTTPS en producción.');
}

// Pre-conectar al origen de la base de datos en cuanto carga el módulo para ahorrar RTT de DNS+TLS
if (typeof document !== 'undefined' && supabaseUrl.startsWith('https://')) {
  try {
    const dbOrigin = new URL(supabaseUrl).origin;
    if (!document.querySelector(`link[rel="preconnect"][href="${dbOrigin}"]`)) {
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = dbOrigin;
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    }
  } catch {
    // Ignorar URL inválida
  }
}

const secureSessionStorage =
  typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : undefined;

export const instrumentedSupabaseFetch = createInstrumentedFetch({
  maxConcurrent: 6,
  primaryUrl: supabaseUrl,
  readUrls: readReplicaUrls,
});

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  db: {
    schema: 'public',
  },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storageKey: 'ct-auth-session',
    storage: secureSessionStorage,
  },
  global: {
    fetch: instrumentedSupabaseFetch,
    headers: {
      'X-Client-Info': 'conciliatributo-web',
      'X-Requested-With': 'XMLHttpRequest',
      'X-Connection-Mode': 'pooler-transaction',
      'Accept-Encoding': 'br, gzip, deflate',
      'X-CSRF-Token': typeof window !== 'undefined' ? getOrCreateCsrfToken() : '',
    },
  },
});
