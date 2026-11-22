import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cabeceras de seguridad y políticas CORS estrictas
const securityHeaders = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-XSS-Protection': '0',
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    cors: {
      origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
      methods: ['GET', 'HEAD', 'POST'],
      credentials: true,
    },
    headers: securityHeaders,
  },
  preview: {
    cors: false,
    headers: securityHeaders,
  },
  build: {
    sourcemap: false,
    minify: true,
  },
});
