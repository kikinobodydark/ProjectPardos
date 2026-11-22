// ============================================================================
// Service Worker de Caché de Archivos Estáticos en el Navegador
// - Estrategia Cache-First inmutable para assets con hash (/assets/*, .webp, .avif, .woff2)
// - Estrategia Network-First con fallback a caché para navegación HTML
// - Ignora peticiones dinámicas a Supabase Auth / REST para preservar seguridad
// ============================================================================
const CACHE_NAME = 'conciliatributo-static-v2';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/icons.svg',
  '/logo-pardos.webp',
  '/logo-pardos.avif',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Nunca cachear llamadas a Supabase ni APIs externas
  if (url.hostname.includes('supabase.co') || url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/')) {
    return;
  }

  // Archivos estáticos inmutables (/assets/, imágenes WebP/AVIF/SVG, fuentes) -> Cache-First
  const isStaticAsset =
    url.pathname.startsWith('/assets/') ||
    /\.(webp|avif|svg|png|woff2?|css|js)(\?.*)?$/i.test(url.pathname);

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Navegación HTML -> Network-First con fallback a caché para redes lentas / micro-cortes
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
  }
});
