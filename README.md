# ConciliaTributo - Sistema de Conciliación Contable (Pardos Chicken)

Sistema web premium diseñado para la consolidación, validación y conciliación de reportes de ventas mensuales de **SAP**, **SUNAT** (comprobantes electrónicos) y el **SIRE** (Sistema Integrado de Registros Electrónicos) del mercado peruano.

---

## 🚀 Características Principales

1. **Conciliación de 3 Vías**:
   - Cruce directo entre **SUNAT ↔ SIRE** por `CAR SUNAT`.
   - Cálculo dinámico del `CAR` contable para **SAP** (`RUC + TipoDoc + Serie(4-char) + Correlativo(10-char padded)`) permitiendo cruce automático total.
2. **Motor de Reglas y Validación Local**:
   - Detección automática y aprobación de **Cortesías** (Total = 0, Op. Gratuitas > 0) eximiendo diferencias alertadas por el SIRE.
   - Validación estricta de documentos de identidad (RUC, DNI, CE, Pasaporte).
   - Bloqueo de placeholders genéricos (ej. nombres como "cliente" o documentos repetitivos como "00000000").
   - Detección de saltos de secuencia (marcado como *OBSERVADO*) y fechas no cronológicas (marcado como *ERROR*).
3. **Paginación Inteligente y Lazy Loading**:
   - Paginación server-side basada en base de datos (`range` en Supabase) para un manejo eficiente de grandes lotes.
   - Búsqueda con debounce de 400ms para optimización de consumo de red.
   - Selector dinámico de tamaño de página (20, 50, 100 filas).
4. **Diseño Visual Premium (Modo Claro)**:
   - Estética limpia con tipografía Inter y JetBrains Mono, contrastes optimizados y bordes redondeados modernos.
5. **Seguridad y Multi-tenant**:
   - Aislamiento total de empresas mediante Row Level Security (RLS) en tablas y vistas (`WITH (security_invoker = true)`).
   - Administración de operadores y empresas incorporada.
6. **Exportación de Reportes**:
   - Descarga directa en formato compatible con Excel usando SheetJS (`xlsx`).

---

## 🛠️ Arquitectura y Tecnologías

- **Frontend**: React + Vite + Bootstrap 5 + React Icons
- **Base de Datos & Backend**: Supabase (PostgreSQL, RLS, Triggers de auditoría, RPCs).
- **Procesamiento de Archivos**: FileReader API en navegador (Soporte UTF-8 con BOM y Windows-1252/Latin-1).

---

## ⚙️ Configuración y Despliegue Local

1. Ingresar al directorio del aplicativo:
   ```bash
   cd app
   ```
2. Instalar dependencias necesarias:
   ```bash
   npm install
   ```
3. Configurar variables de entorno en `/app/.env.local`:
   ```env
   VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
   VITE_SUPABASE_ANON_KEY=tu-anon-key
   ```
4. Levantar servidor de desarrollo local:
   ```bash
   npm run dev
   ```
