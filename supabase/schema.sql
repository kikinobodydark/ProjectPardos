-- 1. Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Tabla de Empresas
CREATE TABLE IF NOT EXISTS public.empresas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ruc VARCHAR(11) UNIQUE NOT NULL,
    razon_social TEXT NOT NULL,
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Tabla de Perfiles de Usuarios (public.usuarios)
CREATE TABLE IF NOT EXISTS public.usuarios (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    empresa_id UUID REFERENCES public.empresas(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    rol TEXT NOT NULL CHECK (rol IN ('admin', 'operador', 'consulta')),
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Tabla de Períodos de Carga
CREATE TABLE IF NOT EXISTS public.periodos_carga (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID REFERENCES public.empresas(id) ON DELETE CASCADE,
    usuario_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    periodo VARCHAR(6) NOT NULL, -- 'YYYYMM'
    dia VARCHAR(2),
    version INTEGER DEFAULT 1,
    fecha_carga TIMESTAMPTZ DEFAULT now(),
    estado TEXT NOT NULL CHECK (estado IN ('procesando', 'completado', 'error')),
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_periodo_empresa_version UNIQUE (empresa_id, periodo, dia, version)
);

-- 5. Tabla del Detalle de Validación (Conciliación)
CREATE TABLE IF NOT EXISTS public.detalle_validacion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    periodo_id UUID REFERENCES public.periodos_carga(id) ON DELETE CASCADE,
    car_sunat VARCHAR(30), -- El CAR de SUNAT
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
    otros_sap NUMERIC(15,2) DEFAULT 0,
    total_sap NUMERIC(15,2) DEFAULT 0,
    
    -- Campos SUNAT
    tipo_identidad_sunat VARCHAR(2),
    nro_identidad_sunat VARCHAR(20),
    nombre_sunat TEXT,
    base_sunat NUMERIC(15,2) DEFAULT 0,
    igv_sunat NUMERIC(15,2) DEFAULT 0,
    otros_sunat NUMERIC(15,2) DEFAULT 0,
    total_sunat NUMERIC(15,2) DEFAULT 0,
    
    -- Campos SIRE
    mensaje_sire TEXT,
    tipo_pago_sire VARCHAR(20) DEFAULT 'NORMAL', -- 'NORMAL' o 'CORTESIA'
    
    -- Estado
    estado_validacion VARCHAR(20) NOT NULL CHECK (estado_validacion IN ('OK', 'OBSERVADO', 'ERROR')),
    errores_json JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    correlativo_int BIGINT GENERATED ALWAYS AS (NULLIF(regexp_replace(correlativo, '[^0-9]', '', 'g'), '')::bigint) STORED,
    buscar_documento TEXT GENERATED ALWAYS AS (
        COALESCE(serie, '') || '-' || COALESCE(correlativo, '') || ' ' || 
        COALESCE(serie, '') || COALESCE(correlativo, '') || ' ' || 
        COALESCE(serie, '') || ' ' || COALESCE(correlativo, '')
    ) STORED,
    
    -- Restricción de unicidad del CAR por período
    CONSTRAINT uq_car_por_periodo UNIQUE (periodo_id, car_sunat)
);

-- 6. Tabla de Auditoría
CREATE TABLE IF NOT EXISTS public.auditoria (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tabla_afectada TEXT NOT NULL,
    operacion TEXT NOT NULL CHECK (operacion IN ('INSERT', 'UPDATE', 'DELETE')),
    usuario_id UUID,
    empresa_id UUID,
    datos_anteriores JSONB,
    datos_nuevos JSONB,
    fecha_hora TIMESTAMPTZ DEFAULT now()
);

-- 7. Índices para Optimización y velocidad de Consultas y RLS
CREATE INDEX IF NOT EXISTS idx_detalle_validacion_periodo_id ON public.detalle_validacion (periodo_id);
CREATE INDEX IF NOT EXISTS idx_detalle_validacion_car_sunat ON public.detalle_validacion (car_sunat);
CREATE INDEX IF NOT EXISTS idx_detalle_validacion_serie_correlativo ON public.detalle_validacion (serie, correlativo);
CREATE INDEX IF NOT EXISTS idx_detalle_validacion_estado_validacion ON public.detalle_validacion (estado_validacion);
CREATE INDEX IF NOT EXISTS idx_detalle_validacion_correlativo_int ON public.detalle_validacion (correlativo_int);
CREATE INDEX IF NOT EXISTS idx_detalle_validacion_fecha_emision ON public.detalle_validacion (fecha_emision);
CREATE INDEX IF NOT EXISTS idx_detalle_validacion_tipo_doc_pago ON public.detalle_validacion (tipo_doc_pago);
CREATE INDEX IF NOT EXISTS idx_detalle_validacion_buscar_documento_trgm ON public.detalle_validacion USING gin (buscar_documento gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_periodos_carga_empresa_id ON public.periodos_carga (empresa_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_empresa_id ON public.usuarios (empresa_id);
