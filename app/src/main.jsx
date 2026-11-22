import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import App from './App.jsx';
import { initWebVitalsObserver } from './utils/telemetry.js';
import { runAfterPageIdle, loadThirdPartyStylesheet } from './utils/thirdPartyLoader.js';
import { setupQueryPersistence } from './utils/queryPersister.js';

// Configuración de TanStack React Query con persistencia en sessionStorage + IndexedDB
// para que al recargar la página (F5) los datos se restauren instantáneamente sin re-descargar
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 60 * 1000, // 30 minutos de frescura (no vuelve a pedir a red al recargar o cambiar de pestaña)
      gcTime: 60 * 60 * 1000,    // 60 minutos en caché
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      retry: 1,
    },
  },
});

// Hidratar y sincronizar caché persistente (sessionStorage + IndexedDB)
setupQueryPersistence(queryClient);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);

runAfterPageIdle(() => {
  initWebVitalsObserver();
  loadThirdPartyStylesheet('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
});
