-- 1. Extensiones necesarias (en schema separado extensions)
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- 2. Tabla de Estudios Contables (Organizaciones)
CREATE TABLE IF NOT EXISTS public.estudios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL,
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Tabla de Empresas
CREATE TABLE IF NOT EXISTS public.empresas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estudio_id UUID NOT NULL REFERENCES public.estudios(id) ON DELETE CASCADE,
    ruc VARCHAR(11) UNIQUE NOT NULL,
    razon_social TEXT NOT NULL,
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT chk_ruc_valid CHECK (length(ruc) = 11 AND ruc ~ '^\d+$')
);

-- 4. Tabla de Perfiles de Usuarios (public.usuarios)
CREATE TABLE IF NOT EXISTS public.usuarios (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    empresa_id UUID REFERENCES public.empresas(id) ON DELETE CASCADE,
    estudio_id UUID NOT NULL REFERENCES public.estudios(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    email TEXT,
    rol TEXT NOT NULL CHECK (rol IN ('admin', 'operador', 'consulta')),
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4.1 Tabla de Relación Muchos a Muchos (public.usuario_empresas)
CREATE TABLE IF NOT EXISTS public.usuario_empresas (
    usuario_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
    empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    PRIMARY KEY (usuario_id, empresa_id)
);

-- 5. Tabla de Períodos de Carga
CREATE TABLE IF NOT EXISTS public.periodos_carga (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID REFERENCES public.empresas(id) ON DELETE CASCADE,
    usuario_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    periodo VARCHAR(6) NOT NULL, -- 'YYYYMM'
    dia VARCHAR(2),
    version INTEGER DEFAULT 1,
    fecha_carga TIMESTAMPTZ DEFAULT now(),
    estado TEXT NOT NULL CHECK (estado IN ('procesando', 'completado', 'error')),
    modulo VARCHAR(10) CHECK (modulo IN ('ventas', 'compras')),
    total_registros INTEGER,
    ok_registros INTEGER,
    observado_registros INTEGER,
    error_registros INTEGER,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_periodo_empresa_version UNIQUE (empresa_id, periodo, dia, version, modulo)
);

-- 6. Tabla del Detalle de Validación (Ventas)
CREATE TABLE IF NOT EXISTS public.detalle_ventas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    periodo_id UUID REFERENCES public.periodos_carga(id) ON DELETE CASCADE,
    empresa_id UUID REFERENCES public.empresas(id) ON DELETE CASCADE,
    car_sunat VARCHAR(30),
    serie VARCHAR(10) NOT NULL,
    correlativo VARCHAR(20) NOT NULL,
    fecha_emision DATE,
    tipo_doc_pago VARCHAR(2) NOT NULL,
    
    -- Campos SAP
    tipo_identidad_sap VARCHAR(2),
    nro_identidad_sap VARCHAR(20),
    nombre_sap TEXT,
    base_sap NUMERIC(15,2) DEFAULT 0,
    igv_sap NUMERIC(15,2) DEFAULT 0,
    exonerado_sap NUMERIC(15,2) DEFAULT 0,
    inafecto_sap NUMERIC(15,2) DEFAULT 0,
    otros_sap NUMERIC(15,2) DEFAULT 0,
    total_sap NUMERIC(15,2) DEFAULT 0,
    
    -- Campos SUNAT
    tipo_identidad_sunat VARCHAR(2),
    nro_identidad_sunat VARCHAR(20),
    nombre_sunat TEXT,
    base_sunat NUMERIC(15,2) DEFAULT 0,
    igv_sunat NUMERIC(15,2) DEFAULT 0,
    exonerado_sunat NUMERIC(15,2) DEFAULT 0,
    inafecto_sunat NUMERIC(15,2) DEFAULT 0,
    otros_sunat NUMERIC(15,2) DEFAULT 0,
    total_sunat NUMERIC(15,2) DEFAULT 0,
    
    -- Campos SIRE
    mensaje_sire TEXT,
    tipo_pago_sire VARCHAR(20) DEFAULT 'NORMAL',
    op_gratuitas NUMERIC(15,2) DEFAULT 0,
    
    -- Estado
    estado_validacion VARCHAR(20) NOT NULL CHECK (estado_validacion IN ('OK', 'OBSERVADO', 'ERROR')),
    errores_json JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    correlativo_int BIGINT,
    buscar_documento TEXT,
    
    CONSTRAINT uq_car_por_periodo_ventas UNIQUE (periodo_id, car_sunat)
);

-- 7. Tabla del Detalle de Validación (Compras)
CREATE TABLE IF NOT EXISTS public.detalle_compras (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    periodo_id UUID REFERENCES public.periodos_carga(id) ON DELETE CASCADE,
    empresa_id UUID REFERENCES public.empresas(id) ON DELETE CASCADE,
    car_sunat VARCHAR(30),
    ruc_proveedor VARCHAR(11),
    serie VARCHAR(10) NOT NULL,
    correlativo VARCHAR(20) NOT NULL,
    fecha_emision DATE,
    tipo_doc_pago VARCHAR(2) NOT NULL,
    
    -- Campos SAP
    tipo_identidad_sap VARCHAR(2),
    nro_identidad_sap VARCHAR(20),
    nombre_sap TEXT,
    base_sap NUMERIC(15,2) DEFAULT 0,
    igv_sap NUMERIC(15,2) DEFAULT 0,
    exonerado_sap NUMERIC(15,2) DEFAULT 0,
    inafecto_sap NUMERIC(15,2) DEFAULT 0,
    otros_sap NUMERIC(15,2) DEFAULT 0,
    total_sap NUMERIC(15,2) DEFAULT 0,
    
    -- Campos SUNAT
    tipo_identidad_sunat VARCHAR(2),
    nro_identidad_sunat VARCHAR(20),
    nombre_sunat TEXT,
    base_sunat NUMERIC(15,2) DEFAULT 0,
    igv_sunat NUMERIC(15,2) DEFAULT 0,
    exonerado_sunat NUMERIC(15,2) DEFAULT 0,
    inafecto_sunat NUMERIC(15,2) DEFAULT 0,
    otros_sunat NUMERIC(15,2) DEFAULT 0,
    total_sunat NUMERIC(15,2) DEFAULT 0,
    
    -- Campos SIRE
    mensaje_sire TEXT,
    
    -- Estado
    estado_validacion VARCHAR(20) NOT NULL CHECK (estado_validacion IN ('OK', 'OBSERVADO', 'ERROR')),
    errores_json JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    correlativo_int BIGINT,
    buscar_documento TEXT,
    
    CONSTRAINT uq_car_por_periodo_compras UNIQUE (periodo_id, car_sunat)
);

-- 8. Tabla de Auditoría
CREATE TABLE IF NOT EXISTS public.auditoria (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tabla_afectada TEXT NOT NULL,
    operacion TEXT NOT NULL CHECK (operacion IN ('INSERT', 'UPDATE', 'DELETE')),
    usuario_id UUID,
    empresa_id UUID,
    estudio_id UUID REFERENCES public.estudios(id),
    datos_anteriores JSONB,
    datos_nuevos JSONB,
    fecha_hora TIMESTAMPTZ DEFAULT now()
);

-- 8.1 Tablas de Locales y Series por Empresa
CREATE TABLE IF NOT EXISTS public.locales_empresa (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_locales_empresa_nombre CHECK (length(trim(nombre)) BETWEEN 2 AND 120)
);

CREATE TABLE IF NOT EXISTS public.local_series (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    local_id UUID NOT NULL REFERENCES public.locales_empresa(id) ON DELETE CASCADE,
    empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    tipo_doc_pago VARCHAR(2) NOT NULL CHECK (tipo_doc_pago IN ('01', '03', '07', '08')),
    serie VARCHAR(10) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_local_series_formato CHECK (serie = upper(trim(serie)) AND length(serie) BETWEEN 2 AND 10),
    CONSTRAINT uq_local_series_empresa_tipo_serie UNIQUE (empresa_id, tipo_doc_pago, serie)
);

-- 9. Índices para Optimización (sin duplicados ni GIN sin uso)
CREATE INDEX IF NOT EXISTS idx_detalle_ventas_empresa_id ON public.detalle_ventas (empresa_id);
CREATE INDEX IF NOT EXISTS idx_detalle_compras_empresa_id ON public.detalle_compras (empresa_id);
CREATE INDEX IF NOT EXISTS idx_periodos_carga_usuario_id ON public.periodos_carga (usuario_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_empresa_id ON public.usuarios (empresa_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_estudio_id ON public.usuarios (estudio_id);
CREATE INDEX IF NOT EXISTS idx_empresas_estudio_id ON public.empresas (estudio_id);
CREATE INDEX IF NOT EXISTS idx_usuario_empresas_empresa_id ON public.usuario_empresas (empresa_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_estudio_fecha ON public.auditoria (estudio_id, fecha_hora DESC);

-- 10. Índices Compuestos para Paginación Determinista, Ordenamiento y Consultas sin N+1
CREATE INDEX IF NOT EXISTS idx_detalle_ventas_periodo_orden_id
  ON public.detalle_ventas (periodo_id, fecha_emision, serie, correlativo, id);
CREATE INDEX IF NOT EXISTS idx_detalle_ventas_periodo_estado
  ON public.detalle_ventas (periodo_id, estado_validacion);
CREATE INDEX IF NOT EXISTS idx_detalle_ventas_periodo_id_pk
  ON public.detalle_ventas (periodo_id, id);
CREATE INDEX IF NOT EXISTS idx_detalle_compras_periodo_orden_id
  ON public.detalle_compras (periodo_id, fecha_emision, serie, correlativo, id);
CREATE INDEX IF NOT EXISTS idx_detalle_compras_periodo_estado
  ON public.detalle_compras (periodo_id, estado_validacion);
CREATE INDEX IF NOT EXISTS idx_detalle_compras_periodo_id_pk
  ON public.detalle_compras (periodo_id, id);
CREATE INDEX IF NOT EXISTS idx_periodos_carga_empresa_modulo_estado
  ON public.periodos_carga (empresa_id, modulo, estado, fecha_carga DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_locales_empresa_empresa_nombre
  ON public.locales_empresa (empresa_id, lower(trim(nombre)));
CREATE INDEX IF NOT EXISTS idx_locales_empresa_empresa_id
  ON public.locales_empresa (empresa_id);
CREATE INDEX IF NOT EXISTS idx_local_series_local_id
  ON public.local_series (local_id);
CREATE INDEX IF NOT EXISTS idx_local_series_empresa_id
  ON public.local_series (empresa_id);

-- 11. Configuración de Pool de Conexiones (Supavisor / PgBouncer Transaction Mode)
ALTER ROLE authenticated SET statement_timeout = '15s';
ALTER ROLE authenticated SET idle_in_transaction_session_timeout = '10s';
