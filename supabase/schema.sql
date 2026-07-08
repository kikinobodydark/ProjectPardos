-- 1. Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
    rol TEXT NOT NULL CHECK (rol IN ('admin', 'operador', 'consulta')),
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
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

-- 9. Índices para Optimización
CREATE INDEX IF NOT EXISTS idx_detalle_ventas_periodo_id ON public.detalle_ventas (periodo_id);
CREATE INDEX IF NOT EXISTS idx_detalle_ventas_empresa_id ON public.detalle_ventas (empresa_id);
CREATE INDEX IF NOT EXISTS idx_detalle_ventas_car_sunat ON public.detalle_ventas (car_sunat);
CREATE INDEX IF NOT EXISTS idx_detalle_compras_periodo_id ON public.detalle_compras (periodo_id);
CREATE INDEX IF NOT EXISTS idx_detalle_compras_empresa_id ON public.detalle_compras (empresa_id);
CREATE INDEX IF NOT EXISTS idx_detalle_compras_car_sunat ON public.detalle_compras (car_sunat);
CREATE INDEX IF NOT EXISTS idx_periodos_carga_empresa_id ON public.periodos_carga (empresa_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_empresa_id ON public.usuarios (empresa_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_estudio_id ON public.usuarios (estudio_id);
CREATE INDEX IF NOT EXISTS idx_empresas_estudio_id ON public.empresas (estudio_id);
