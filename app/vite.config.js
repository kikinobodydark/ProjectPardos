import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Cabeceras de seguridad, compresión y caché en navegador/CDN
const securityHeaders = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-XSS-Protection': '0',
  'Vary': 'Accept-Encoding',
};

/**
 * Plugin de Compilación:
 * 1. Pre-renderiza metadatos de compilación (SSG / Build-Time Rendering) en index.html
 * 2. Activa compresión Brotli (.br calidad 11) y Gzip (.gz) para servidores propios
 *    (en Vercel la CDN Edge aplica Brotli automáticamente al servir los archivos)
 */
function brotliAndPrerenderPlugin() {
  return {
    name: 'conciliatributo-brotli-and-prerender',
    transformIndexHtml(html) {
      const buildTimestamp = new Date().toISOString();
      return html.replace(
        '<meta name="viewport"',
        `<meta name="x-prerendered-at" content="${buildTimestamp}" />\n    <meta name="viewport"`
      );
    },
    closeBundle() {
      if (process.env.VERCEL) return;
      const distDir = path.resolve(__dirname, 'dist');
      if (!fs.existsSync(distDir)) return;

      const compressibleExts = new Set(['.js', '.css', '.html', '.svg', '.json']);
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (compressibleExts.has(path.extname(entry.name))) {
            const raw = fs.readFileSync(fullPath);
            if (raw.length < 512) continue;

            const br = zlib.brotliCompressSync(raw, {
              params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
                [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
              },
            });
            fs.writeFileSync(`${fullPath}.br`, br);

            const gz = zlib.gzipSync(raw, { level: 9 });
            fs.writeFileSync(`${fullPath}.gz`, gz);
          }
        }
      };

      walk(distDir);
    },
  };
}

const cdnBaseUrl = process.env.VITE_CDN_URL || '/';

export default defineConfig({
  base: cdnBaseUrl,
  plugins: [react(), brotliAndPrerenderPlugin()],
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
    headers: {
      ...securityHeaders,
      'Cache-Control': 'public, max-age=3600',
    },
  },
  build: {
    sourcemap: false,
    minify: true,
    target: 'es2020',
    cssCodeSplit: true,
    assetsInlineLimit: 4096,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('xlsx')) return 'vendor-xlsx';
            if (id.includes('@supabase')) return 'vendor-supabase';
            if (id.includes('@tanstack')) return 'vendor-query';
            if (id.includes('react-icons')) return 'vendor-icons';
            if (id.includes('react')) return 'vendor-react';
          }
          return undefined;
        },
      },
    },
  },
});
