import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import App from './App.jsx';
import { initWebVitalsObserver } from './utils/telemetry.js';
import { runAfterPageIdle, loadThirdPartyStylesheet } from './utils/thirdPartyLoader.js';

// Configuración de caché inteligente en cliente para evitar llamadas duplicadas
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutos sin re-consultar datos frescos
      gcTime: 15 * 60 * 1000,   // 15 minutos en memoria caché
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);

// Inicializar observadores OpenTelemetry y cargar recursos externos/Service Worker después de la página
runAfterPageIdle(() => {
  initWebVitalsObserver();
  loadThirdPartyStylesheet('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
});
