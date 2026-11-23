// ============================================================================
// Proyecciones de columnas SQL centralizadas (evita SELECT * y duplicación).
// ============================================================================

export const COLS_EMPRESA = 'id, ruc, razon_social, activo, estudio_id';

export const COLS_USUARIO_PERFIL =
  'id, nombre, rol, activo, empresa_id, estudio_id, empresas!usuarios_empresa_id_fkey(id, ruc, razon_social, activo, estudio_id)';

export const COLS_PERIODO =
  'id, empresa_id, periodo, dia, version, fecha_carga, estado, modulo, total_registros, resumen_json';

export const COLS_USUARIOS_LISTA =
  'id, nombre, email, rol, activo, estudio_id, empresa_id, usuario_empresas(empresa_id, empresas(razon_social))';
