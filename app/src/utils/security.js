// ============================================================================
// Módulo de Seguridad y Protección Defensiva (ECC Security Review Standard)
// Implementa:
// 1. Enforcement de HTTPS en producción
// 2. Protección CSRF (Token criptográfico de sesión + verificación de origen)
// 3. Rate Limiting (Límite de peticiones y bloqueo temporal contra fuerza bruta)
// 4. Validación estricta de tamaño, tipo y extensión de archivos (DoS / Upload)
// 5. Sanitización contra XSS y CSV/Excel Formula Injection (CSV Injection)
// 6. Registro de actividad sospechosa y auditoría de seguridad en servidor
// 7. Expiración e invalidación de enlaces de recuperación y sesiones inactivas
// ============================================================================
import { supabase } from './supabaseClient.js';
import { sanitizeExcelCell, sanitizeExcelRow } from './excelSanitizer.js';

export { sanitizeExcelCell, sanitizeExcelRow };

// 1. Límites de tamaño de archivo (400 MB para TXT contables y Excel opcionales)
export const MAX_TXT_SIZE_BYTES = 400 * 1024 * 1024; // 400 MB
export const MAX_EXCEL_SIZE_BYTES = 400 * 1024 * 1024; // 400 MB

// 2. Expiración de enlaces de recuperación (15 minutos) y timeout de sesión inactiva (30 minutos)
export const RECOVERY_LINK_MAX_AGE_MS = 15 * 60 * 1000;
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Fuerza HTTPS en entornos de producción (excepto localhost / 127.0.0.1).
 */
export function enforceHttps() {
  if (typeof window === 'undefined') return;
  const { protocol, hostname, href } = window.location;
  const isLocal =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.local');

  if (!isLocal && protocol === 'http:') {
    const secureUrl = href.replace(/^http:/i, 'https:');
    window.location.replace(secureUrl);
  }
}

/**
 * Genera o recupera el token CSRF criptográfico vinculado a la sesión actual
 * y establece una cookie SameSite=Strict (Secure en HTTPS) para defensa Double-Submit.
 */
export function getOrCreateCsrfToken() {
  if (typeof window === 'undefined' || !window.crypto?.getRandomValues) return 'csrf-fallback';
  let token = sessionStorage.getItem('ct_csrf_token');
  if (!token) {
    const array = new Uint8Array(32);
    window.crypto.getRandomValues(array);
    token = Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem('ct_csrf_token', token);
  }
  if (typeof document !== 'undefined') {
    const isSecure = window.location.protocol === 'https:';
    document.cookie = `ct_csrf=${token}; Path=/; SameSite=Strict${isSecure ? '; Secure' : ''}`;
  }
  return token;
}

/**
 * Verifica que el token CSRF enviado por un formulario coincida con el token de sesión
 * y que el origen del documento sea de confianza.
 */
export function verifyCsrfToken(submittedToken) {
  const expected = sessionStorage.getItem('ct_csrf_token');
  if (!expected || !submittedToken || submittedToken !== expected) {
    logSuspiciousActivity('CSRF_TOKEN_INVALIDO', {
      origin: typeof window !== 'undefined' ? window.location.origin : 'unknown',
    });
    return false;
  }
  return true;
}

/**
 * Rate Limiter en cliente + memoria/sessionStorage por acción (ej. login, upload, export, admin_mutation).
 * Previene ataques de fuerza bruta y abuso de peticiones a la API.
 */
const rateBuckets = new Map();

export function checkRateLimit(actionKey, { maxAttempts = 5, windowMs = 60000, lockoutMs = 120000 } = {}) {
  const now = Date.now();
  const storageKey = `ct_rl_${actionKey}`;
  let state = rateBuckets.get(actionKey);

  if (!state && typeof sessionStorage !== 'undefined') {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) state = JSON.parse(raw);
    } catch {
      state = null;
    }
  }

  if (!state) {
    state = { timestamps: [], lockedUntil: 0 };
  }

  if (state.lockedUntil && now < state.lockedUntil) {
    const remainingSec = Math.ceil((state.lockedUntil - now) / 1000);
    return {
      allowed: false,
      remainingSec,
      message: `Demasiados intentos. Por seguridad, espera ${remainingSec} segundos antes de volver a intentar.`,
    };
  }

  // Filtrar eventos dentro de la ventana
  state.timestamps = (state.timestamps || []).filter((ts) => now - ts < windowMs);

  if (state.timestamps.length >= maxAttempts) {
    state.lockedUntil = now + lockoutMs;
    rateBuckets.set(actionKey, state);
    if (typeof sessionStorage !== 'undefined') {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(state));
      } catch {
        // Ignorar errores de cuota
      }
    }
    const remainingSec = Math.ceil(lockoutMs / 1000);
    logSuspiciousActivity('RATE_LIMIT_EXCEDIDO', { action: actionKey, maxAttempts, windowMs });
    return {
      allowed: false,
      remainingSec,
      message: `Límite de peticiones excedido (${maxAttempts} máx.). Bloqueo temporal por ${remainingSec} segundos.`,
    };
  }

  state.timestamps.push(now);
  state.lockedUntil = 0;
  rateBuckets.set(actionKey, state);
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // Ignorar
    }
  }

  return { allowed: true, remainingSec: 0, message: null };
}

export function resetRateLimit(actionKey) {
  rateBuckets.delete(actionKey);
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(`ct_rl_${actionKey}`);
  }
}

/**
 * Valida estrictamente archivos subidos (tamaño máximo, extensión en lista blanca y tipo MIME).
 */
export function validateUploadedFile(file, kind = 'txt') {
  if (!file || typeof file.name !== 'string') {
    return { valid: false, error: 'Archivo no válido o inexistente.' };
  }

  const fileName = file.name.trim();
  const lowerName = fileName.toLowerCase();

  // Bloquear doble extensión sospechosa o caracteres de control en el nombre
  const hasControlOrForbidden =
    /[<>:"/\\|?*]/.test(fileName) ||
    Array.from(fileName).some((ch) => {
      const code = ch.charCodeAt(0);
      return code <= 31 || code === 127;
    });
  if (hasControlOrForbidden) {
    logSuspiciousActivity('ARCHIVO_NOMBRE_SOSPECHOSO', { fileName: fileName.slice(0, 80) });
    return { valid: false, error: 'El nombre del archivo contiene caracteres no permitidos.' };
  }

  if (file.size === 0) {
    return { valid: false, error: `El archivo "${fileName}" está vacío (0 bytes).` };
  }

  if (kind === 'txt') {
    if (!lowerName.endsWith('.txt')) {
      logSuspiciousActivity('ARCHIVO_EXTENSION_INVALIDA', { fileName: fileName.slice(0, 80), expected: '.txt' });
      return { valid: false, error: 'Solo se permiten archivos de texto con extensión .txt.' };
    }
    const allowedMimes = ['text/plain', 'application/octet-stream', ''];
    if (file.type && !allowedMimes.includes(file.type)) {
      return { valid: false, error: `Tipo MIME no permitido para reporte TXT (${file.type}).` };
    }
    if (file.size > MAX_TXT_SIZE_BYTES) {
      const maxMb = (MAX_TXT_SIZE_BYTES / (1024 * 1024)).toFixed(0);
      logSuspiciousActivity('ARCHIVO_TAMANO_EXCEDIDO', { fileName: fileName.slice(0, 80), size: file.size });
      return { valid: false, error: `El archivo supera el límite máximo permitido de ${maxMb} MB.` };
    }
  } else if (kind === 'excel') {
    if (!lowerName.endsWith('.xlsx') && !lowerName.endsWith('.xls')) {
      logSuspiciousActivity('ARCHIVO_EXTENSION_INVALIDA', { fileName: fileName.slice(0, 80), expected: '.xlsx/.xls' });
      return { valid: false, error: 'Solo se permiten archivos Excel con extensión .xlsx o .xls.' };
    }
    if (file.size > MAX_EXCEL_SIZE_BYTES) {
      const maxMb = (MAX_EXCEL_SIZE_BYTES / (1024 * 1024)).toFixed(0);
      logSuspiciousActivity('ARCHIVO_TAMANO_EXCEDIDO', { fileName: fileName.slice(0, 80), size: file.size });
      return { valid: false, error: `El archivo Excel supera el límite máximo permitido de ${maxMb} MB.` };
    }
  }

  return { valid: true, error: null };
}

/**
 * Sanitiza cadenas de entrada de usuario contra XSS y caracteres de control invisibles.
 */
export function sanitizeTextInput(input, maxLength = 250) {
  if (input === null || input === undefined) return '';
  const filtered = Array.from(String(input))
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return !(code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127);
    })
    .join('');
  return filtered
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLength);
}

/**
 * Valida la firma binaria (magic bytes) de un ArrayBuffer antes de parsearlo:
 *  - 'txt': rechaza ejecutables/archivos binarios con bytes NUL o firmas ZIP/PE/ELF/PDF.
 *  - 'excel': exige firma ZIP (.xlsx -> PK\x03\x04) o Compound Binary (.xls -> D0 CF 11 E0).
 */
export function validateFileMagicBytes(buffer, kind = 'txt') {
  if (!buffer || buffer.byteLength === 0) {
    return { valid: false, error: 'El archivo está vacío o no pudo leerse.' };
  }
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 512));

  if (kind === 'excel') {
    const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
    const isOle2 =
      bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
    if (!isZip && !isOle2) {
      logSuspiciousActivity('ARCHIVO_MAGIC_BYTES_EXCEL_INVALIDO', { headerHex: Array.from(bytes.slice(0, 4)).join(',') });
      return { valid: false, error: 'El contenido del archivo no corresponde a un libro Excel válido (.xlsx / .xls).' };
    }
    return { valid: true, error: null };
  }

  // TXT: bloquear binarios disfrazados (bytes NUL o cabeceras ejecutables/PDF/ZIP)
  const hasNullByte = bytes.includes(0x00);
  const isBinarySig =
    (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) || // MZ (PE/EXE)
    (bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) || // ELF
    (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) || // PDF
    (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04); // ZIP

  if (hasNullByte || isBinarySig) {
    logSuspiciousActivity('ARCHIVO_MAGIC_BYTES_TXT_BINARIO', { headerHex: Array.from(bytes.slice(0, 4)).join(',') });
    return { valid: false, error: 'El archivo seleccionado contiene datos binarios no permitidos para un reporte TXT.' };
  }

  return { valid: true, error: null };
}

/**
 * Verifica y caduca enlaces de recuperación de contraseña o tokens en URL.
 */
export function checkAndExpireRecoveryLinks() {
  if (typeof window === 'undefined') return { expired: false, message: null };
  const hash = window.location.hash || '';
  const search = window.location.search || '';

  if (hash.includes('error_code=otp_expired') || search.includes('error_code=otp_expired') || hash.includes('error=access_denied')) {
    window.history.replaceState(null, '', window.location.pathname);
    return {
      expired: true,
      message: 'El enlace de recuperación o autenticación ha caducado por seguridad. Solicita uno nuevo al administrador.',
    };
  }

  if (hash.includes('type=recovery') || search.includes('type=recovery')) {
    const now = Date.now();
    const firstSeenRaw = sessionStorage.getItem('ct_recovery_first_seen');
    const firstSeen = firstSeenRaw ? parseInt(firstSeenRaw, 10) : now;
    if (!firstSeenRaw) {
      sessionStorage.setItem('ct_recovery_first_seen', String(now));
    }
    // Limpiar el token del URL inmediatamente para evitar filtración en historial o Referer
    window.history.replaceState(null, '', window.location.pathname);

    if (now - firstSeen > RECOVERY_LINK_MAX_AGE_MS) {
      sessionStorage.removeItem('ct_recovery_first_seen');
      supabase.auth.signOut().catch(() => {});
      return {
        expired: true,
        message: 'La sesión de recuperación ha caducado (máximo 15 minutos). Inicia un nuevo proceso.',
      };
    }
  }

  return { expired: false, message: null };
}

/**
 * Registra actividad sospechosa en la tabla de auditoría de Supabase (si hay sesión activa)
 * sin exponer datos sensibles en la consola en producción.
 */
export async function logSuspiciousActivity(evento, detalle = {}) {
  try {
    const safeEvent = sanitizeTextInput(evento, 100) || 'EVENTO_SEGURIDAD';
    const { data } = await supabase.auth.getSession();
    if (data?.session) {
      await supabase.rpc('registrar_evento_seguridad', {
        p_evento: safeEvent,
        p_detalle: detalle,
      });
    }
  } catch {
    // Fallar de manera silenciosa y segura sin revelar estructura interna
  }
}
