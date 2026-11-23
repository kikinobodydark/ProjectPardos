# ConciliaTributo — Sistema de Conciliación Contable (Pardos Chicken)

Sistema web diseñado para la consolidación, validación y conciliación de registros contables de **Ventas (RVIE / PLE 14.1)** y **Compras (RCE / PLE 8.1)** comparando archivos exportados de **SAP** vs. **SUNAT** (más archivos Excel opcionales de cortesías en Ventas y usuarios SAP en Compras).

---

## Características Principales

1. **Módulo de Ventas (SAP vs. SUNAT + Cortesías)**:
   - Conciliación exacta en céntimos enteros con tolerancia configurable de S/ 0.05 en montos (BI Gravada, IGV, Exonerado, Inafecto, Otros Tributos y Total).
   - Validación de identidad (DNI, RUC 10/15/20, CE, Otros y boletas > S/ 700 sin DNI).
   - Análisis de saltos de correlativos por serie diferenciando SAP, SUNAT o AMBOS.
   - Gestión de **Locales y Series** por empresa para filtrar Dashboard, tabla y reportes por restaurante/sede.
   - 12 reportes específicos exportables a Excel (`.xlsx`) con sanitización contra Formula/CSV Injection.

2. **Módulo de Compras (SAP vs. SUNAT — RCE)**:
   - Cruce por clave única preservando ceros a la izquierda (`RUC Proveedor + Tipo Doc + Serie + Correlativo`).
   - 8 categorías de errores (incluyendo excepción de Recibos Tipo 14 y soporte para Nota de Débito `08`/`09`) y 3 observaciones de identidad independientes.
   - Exportación multi-hoja a Excel respetando filtros activos o totalidad del lote.

3. **Arquitectura de Rendimiento y Resiliencia**:
   - Pool de Web Workers paralelos con recuperación automática por slot (`jobQueue.js`).
   - Caché persistente híbrida (`sessionStorage` + `IndexedDB`) con limpieza automática al cerrar sesión o cambiar de usuario.
   - Virtualización de listas largas, `ErrorBoundary` global y compresión Brotli/Gzip en build.

4. **Seguridad y Multi-tenant (Estándar ECC)**:
   - Aislamiento por estudio y empresa mediante Row Level Security (RLS) sin políticas superpuestas y vistas `WITH (security_invoker = true)`.
   - RPCs atómicas (`insertar_lote_ventas`, `insertar_lote_compras`, `finalizar_periodo_carga`, `guardar_local_con_series`) con validación `SECURITY INVOKER` y revocación de permisos a `PUBLIC`/`anon`.
   - Validación de extensión, tamaño y firma binaria (*magic bytes*) en cargas de archivos.

---

## Arquitectura y Tecnologías

- **Frontend**: React 19 + Vite 8 + TanStack React Query 5 + Bootstrap 5 + React Icons + SheetJS (`xlsx`).
- **Base de Datos y Backend**: Supabase (PostgreSQL 17, Auth PKCE, RLS, Triggers de auditoría y RPCs atómicas).
- **Calidad y CI**: `oxlint`, pruebas automatizadas en Node (`verify.js`, `verify-compras.js`, `node:test`) y GitHub Actions (`.github/workflows/ci.yml`).

---

## Configuración y Despliegue Local

1. Ingresar al directorio del aplicativo:
   ```bash
   cd app
   ```
2. Instalar dependencias:
   ```bash
   npm ci
   ```
3. Configurar variables de entorno en `app/.env.local` (basado en `app/.env.example`):
   ```env
   VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
   VITE_SUPABASE_ANON_KEY=tu-publishable-or-anon-key
   ```
4. Scripts disponibles:
   ```bash
   npm run dev      # Servidor de desarrollo local
   npm run lint     # Análisis estático (oxlint)
   npm test         # Suite de verificación de Ventas, Compras y seguridad ECC
   npm run build    # Compilación de producción
   ```

## Migraciones de Base de Datos

Los scripts base viven en `supabase/` (`schema.sql`, `views.sql`, `triggers_and_rpc.sql`) y las migraciones incrementales en `supabase/migrations/`.
