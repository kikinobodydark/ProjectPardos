// ============================================================================
// Componente de Imagen Optimizada (AVIF + WebP + Lazy Loading + CDN Prefix)
// Sirve formatos de próxima generación (AVIF y WebP) con fallback seguro,
// decodificación asíncrona y dimensiones explícitas para evitar CLS.
// ============================================================================
import React, { memo } from 'react';

const CDN_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_CDN_URL) || '';

function resolveCdnUrl(path) {
  if (!path) return '';
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  const cleanBase = CDN_BASE.replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}

const OptimizedImage = memo(function OptimizedImage({
  src,
  avifSrc,
  webpSrc,
  alt = '',
  width,
  height,
  priority = false,
  className = '',
  style = {},
}) {
  const baseNoExt = src ? src.replace(/\.(png|jpe?g|webp|avif)$/i, '') : '';
  const finalAvif = resolveCdnUrl(avifSrc || (baseNoExt ? `${baseNoExt}.avif` : ''));
  const finalWebp = resolveCdnUrl(webpSrc || (baseNoExt ? `${baseNoExt}.webp` : ''));
  const finalFallback = resolveCdnUrl(src);

  return (
    <picture className={className} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      {finalAvif && <source srcSet={finalAvif} type="image/avif" />}
      {finalWebp && <source srcSet={finalWebp} type="image/webp" />}
      <img
        src={finalFallback}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
        style={{ maxWidth: '100%', height: 'auto', ...style }}
      />
    </picture>
  );
});

export default OptimizedImage;
