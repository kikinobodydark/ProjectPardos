import { createClient } from '@supabase/supabase-js';
import { getOrCreateCsrfToken } from './security';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  if (import.meta.env.DEV) {
    console.error('Faltan variables de entorno de Supabase. Revisa .env.local');
  }
}

// Validar que en producción la URL de Supabase utilice obligatoriamente HTTPS
if (supabaseUrl && import.meta.env.PROD && !supabaseUrl.startsWith('https://')) {
  throw new Error('Configuración insegura: VITE_SUPABASE_URL debe utilizar HTTPS en producción.');
}

// Almacenamiento de sesión aislado en sessionStorage (se destruye al cerrar la pestaña/navegador,
// reduciendo la ventana de exposición ante XSS frente a localStorage persistente)
const secureSessionStorage =
  typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : undefined;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storageKey: 'ct-auth-session',
    storage: secureSessionStorage,
  },
  global: {
    headers: {
      'X-Client-Info': 'conciliatributo-web',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-Token': typeof window !== 'undefined' ? getOrCreateCsrfToken() : '',
    },
  },
});
