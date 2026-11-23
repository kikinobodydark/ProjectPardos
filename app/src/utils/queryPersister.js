// ============================================================================
// Persistencia de Caché para TanStack React Query (IndexedDB + sessionStorage)
// - Metadatos ligeros (`userProfile`, `companies`, `periods`, `cargaHistory`,
//   `dashboardStats`) se persisten en `sessionStorage` para hidratación SÍNCRONA (0 ms).
// - Lotes masivos (`ventasDocumentos`, `comprasDocumentos`) se leen bajo demanda
//   desde `IndexedDB` por `periodId` (sin cargar todos los períodos a RAM al iniciar)
//   y conservando únicamente los 2 períodos más recientes para evitar saturar disco/RAM.
// ============================================================================

const SESSION_CACHE_KEY = 'ct_rq_sync_cache_v1';
const LEGACY_IDB_NAMES = [
  'conciliatributo_rq_idb_v1',
  'conciliatributo_rq_idb_v2',
  'conciliatributo_rq_idb_v3',
];
const IDB_NAME = 'conciliatributo_rq_idb_v4';
const IDB_STORE = 'queries';
const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutos de validez de caché
const MAX_IDB_ENTRIES = 2; // Conservar a lo sumo los 2 lotes más recientes
const MAX_IDB_DOCS_COUNT = 120000; // Evitar congelar el hilo principal con structuredClone > 120k docs
export const IDB_DOCS_CACHE_VERSION = 2;
let legacyIdbCleaned = false;

const SYNC_QUERY_PREFIXES = new Set([
  'userProfile',
  'companies',
  'localesEmpresa',
  'periods',
  'cargaHistory',
  'dashboardStats',
  'existingFilters',
  'usuarios',
]);

let activeSyncEntries = {};
let activeSyncSaveTimer = null;

function openIdb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!legacyIdbCleaned) {
    legacyIdbCleaned = true;
    for (const oldName of LEGACY_IDB_NAMES) {
      try {
        indexedDB.deleteDatabase(oldName);
      } catch {
        // Ignorar si el navegador no permite eliminar la BD anterior
      }
    }
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function pruneOldIdbEntries(db, keepHash) {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const keysReq = store.getAllKeys();
      keysReq.onsuccess = () => {
        const keys = keysReq.result || [];
        if (keys.length <= MAX_IDB_ENTRIES) {
          resolve();
          return;
        }
        const keysToDelete = keys.filter((k) => k !== keepHash).slice(0, keys.length - MAX_IDB_ENTRIES);
        for (const k of keysToDelete) {
          store.delete(k);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function idbSetQuery(queryHash, queryKey, data, cacheVersion = IDB_DOCS_CACHE_VERSION) {
  if (Array.isArray(data) && data.length > MAX_IDB_DOCS_COUNT) {
    return false;
  }
  const db = await openIdb();
  if (!db) return false;
  await pruneOldIdbEntries(db, queryHash);
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(
        { queryKey, data, cacheVersion, updatedAt: Date.now() },
        queryHash
      );
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function idbGetQueryEntry(queryHash) {
  const db = await openIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(queryHash);
      req.onsuccess = () => {
        const entry = req.result;
        if (!entry || Date.now() - entry.updatedAt > MAX_AGE_MS) {
          resolve(null);
        } else {
          resolve(entry);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function idbGetQuery(queryHash) {
  const entry = await idbGetQueryEntry(queryHash);
  return entry ? entry.data : null;
}

export async function clearPersistedQueryCache() {
  clearTimeout(activeSyncSaveTimer);
  activeSyncEntries = {};
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(SESSION_CACHE_KEY);
  }
  const db = await openIdb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Hidrata síncronamente `queryClient` desde `sessionStorage` antes del primer render.
 * Los lotes grandes en IndexedDB se leen de forma perezosa desde cada hook por `periodId`
 * para evitar cargar múltiples períodos masivos a RAM simultáneamente al iniciar.
 */
export function setupQueryPersistence(queryClient) {
  if (typeof window === 'undefined') return;

  // 1. Hidratación síncrona inmediata (0 ms) desde sessionStorage
  try {
    const raw = sessionStorage.getItem(SESSION_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const now = Date.now();
      for (const entry of Object.values(parsed)) {
        if (entry && entry.queryKey && now - entry.updatedAt <= MAX_AGE_MS) {
          queryClient.setQueryData(entry.queryKey, entry.data, {
            updatedAt: entry.updatedAt,
          });
        }
      }
    }
  } catch {
    // Ignorar errores de parseo
  }

  // 2. Suscribirse a actualizaciones exitosas del QueryCache para persistir metadatos ligeros
  activeSyncEntries = (() => {
    try {
      const raw = sessionStorage.getItem(SESSION_CACHE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  })();

  queryClient.getQueryCache().subscribe((event) => {
    if (!event?.query) return;
    const query = event.query;
    const queryKey = query.queryKey;
    const prefix = Array.isArray(queryKey) ? queryKey[0] : null;
    if (!prefix) return;

    if (event.type === 'removed') {
      if (SYNC_QUERY_PREFIXES.has(prefix)) {
        delete activeSyncEntries[query.queryHash];
      }
      return;
    }

    if (event.type === 'updated' && query.state.status === 'success' && query.state.data !== undefined) {
      if (SYNC_QUERY_PREFIXES.has(prefix)) {
        activeSyncEntries[query.queryHash] = {
          queryKey,
          data: query.state.data,
          updatedAt: query.state.dataUpdatedAt || Date.now(),
        };
        clearTimeout(activeSyncSaveTimer);
        activeSyncSaveTimer = setTimeout(() => {
          try {
            sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(activeSyncEntries));
          } catch {
            // Si excede cuota, limpiar entradas antiguas
          }
        }, 120);
      }
    }
  });
}
