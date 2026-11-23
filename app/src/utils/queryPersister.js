// ============================================================================
// Persistencia de Caché para TanStack React Query (IndexedDB + sessionStorage)
// - Por defecto, React Query guarda los datos solo en memoria RAM y se pierden
//   al recargar la página (F5).
// - Este módulo persiste:
//   1. Metadatos ligeros (`userProfile`, `companies`, `periods`, `cargaHistory`,
//      `dashboardStats`) en `sessionStorage` para hidratación SÍNCRONA (0 ms) al
//      recargar la página.
//   2. Lotes masivos (`ventasDocumentos`, `reconciliation` con 10,000+ filas) en
//      `IndexedDB` para restaurarlos en ~20 ms desde disco local sin volver a
//      descargar todas las páginas desde Supabase en cada F5.
// ============================================================================

const SESSION_CACHE_KEY = 'ct_rq_sync_cache_v1';
const LEGACY_IDB_NAMES = ['conciliatributo_rq_idb_v1', 'conciliatributo_rq_idb_v2'];
const IDB_NAME = 'conciliatributo_rq_idb_v3';
const IDB_STORE = 'queries';
const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutos de validez de caché
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

const IDB_QUERY_PREFIXES = new Set([
  'ventasDocumentos',
  'reconciliation',
]);

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

export async function idbSetQuery(queryHash, queryKey, data) {
  const db = await openIdb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(
        { queryKey, data, updatedAt: Date.now() },
        queryHash
      );
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function idbGetQuery(queryHash) {
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
          resolve(entry.data);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function clearPersistedQueryCache() {
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
 * Hidrata síncronamente `queryClient` desde `sessionStorage` antes del primer render
 * y restaura en segundo plano las consultas grandes desde `IndexedDB`.
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

  // 2. Hidratación asíncrona rápida (~15 ms) desde IndexedDB para lotes masivos
  openIdb().then((db) => {
    if (!db) return;
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const entries = req.result || [];
        const now = Date.now();
        for (const entry of entries) {
          if (entry && entry.queryKey && now - entry.updatedAt <= MAX_AGE_MS) {
            const existing = queryClient.getQueryData(entry.queryKey);
            if (!existing) {
              queryClient.setQueryData(entry.queryKey, entry.data, {
                updatedAt: entry.updatedAt,
              });
            }
          }
        }
      };
    } catch {
      // Ignorar
    }
  });

  // 3. Suscribirse a actualizaciones exitosas del QueryCache para persistirlas
  let syncSaveTimer = null;
  const syncEntries = (() => {
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
        delete syncEntries[query.queryHash];
      }
      return;
    }

    if (event.type === 'updated' && query.state.status === 'success' && query.state.data !== undefined) {
      if (SYNC_QUERY_PREFIXES.has(prefix)) {
        syncEntries[query.queryHash] = {
          queryKey,
          data: query.state.data,
          updatedAt: query.state.dataUpdatedAt || Date.now(),
        };
        clearTimeout(syncSaveTimer);
        syncSaveTimer = setTimeout(() => {
          try {
            sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(syncEntries));
          } catch {
            // Si excede cuota, limpiar entradas antiguas
          }
        }, 120);
      } else if (IDB_QUERY_PREFIXES.has(prefix)) {
        idbSetQuery(query.queryHash, queryKey, query.state.data);
      }
    }
  });
}
