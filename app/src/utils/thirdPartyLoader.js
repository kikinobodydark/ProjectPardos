// ============================================================================
// Cargador Diferido de Scripts y Recursos de Terceros (Post-Page Load / Idle)
// Garantiza que ningún recurso externo o analítica bloquee el First Contentful
// Paint (FCP) ni el Largest Contentful Paint (LCP).
// ============================================================================

const loadedResources = new Map();

export function runAfterPageIdle(callback, timeout = 2500) {
  if (typeof window === 'undefined') return;

  const scheduleIdle = () => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => callback(), { timeout });
    } else {
      setTimeout(callback, 120);
    }
  };

  if (document.readyState === 'complete') {
    scheduleIdle();
  } else {
    window.addEventListener('load', scheduleIdle, { once: true, passive: true });
  }
}

export function loadThirdPartyScript(src, { async = true, defer = true, attributes = {} } = {}) {
  if (typeof document === 'undefined') return Promise.resolve(null);
  if (loadedResources.has(src)) return loadedResources.get(src);

  const promise = new Promise((resolve, reject) => {
    runAfterPageIdle(() => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        resolve(existing);
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = async;
      script.defer = defer;
      for (const [k, v] of Object.entries(attributes)) {
        script.setAttribute(k, v);
      }
      script.onload = () => resolve(script);
      script.onerror = (err) => reject(err);
      document.body.appendChild(script);
    });
  });

  loadedResources.set(src, promise);
  return promise;
}

export function loadThirdPartyStylesheet(href) {
  if (typeof document === 'undefined') return Promise.resolve(null);
  if (loadedResources.has(href)) return loadedResources.get(href);

  const promise = new Promise((resolve) => {
    runAfterPageIdle(() => {
      const existing = document.querySelector(`link[rel="stylesheet"][href="${href}"]`);
      if (existing) {
        resolve(existing);
        return;
      }
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.media = 'print';
      link.onload = () => {
        link.media = 'all';
        resolve(link);
      };
      document.head.appendChild(link);
    });
  });

  loadedResources.set(href, promise);
  return promise;
}
