// ============================================================================
// Componentes de Esqueletos de Carga (Skeleton Loaders)
// Evitan saltos de diseño (CLS) y brindan retroalimentación visual inmediata
// mientras se resuelven consultas paginadas o se cargan módulos divididos.
// ============================================================================
import React, { memo } from 'react';

export const SkeletonBlock = memo(function SkeletonBlock({
  width = '100%',
  height = '16px',
  borderRadius = '6px',
  className = '',
  style = {},
}) {
  return (
    <div
      className={`skeleton-shimmer ${className}`}
      style={{ width, height, borderRadius, ...style }}
      aria-hidden="true"
    />
  );
});

export const SkeletonKpiGrid = memo(function SkeletonKpiGrid({ count = 10 }) {
  return (
    <div className="row g-2 mb-3" role="status" aria-busy="true" aria-label="Cargando indicadores">
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className={count > 4 ? 'col-xl col-lg-4 col-md-6' : 'col-xl-3 col-sm-6'}
          style={count > 4 ? { minWidth: '18%' } : undefined}
        >
          <div className="card-premium d-flex align-items-center p-2.5 h-100" style={{ padding: '0.85rem 1rem' }}>
            <SkeletonBlock width="40px" height="40px" borderRadius="10px" className="me-2.5 flex-shrink-0" style={{ marginRight: '0.75rem' }} />
            <div className="flex-grow-1">
              <SkeletonBlock width="65%" height="10px" className="mb-2" />
              <SkeletonBlock width="45%" height="20px" className="mb-1" />
              <SkeletonBlock width="80%" height="9px" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
});

export const SkeletonTable = memo(function SkeletonTable({ rows = 8, columns = 8, title = 'Cargando registros...' }) {
  return (
    <div className="w-100 py-2" role="status" aria-busy="true" aria-label={title}>
      <div className="table-responsive">
        <table className="table table-dense align-middle mb-0">
          <thead>
            <tr>
              {Array.from({ length: columns }).map((_, cIdx) => (
                <th key={cIdx}>
                  <SkeletonBlock width={`${60 + ((cIdx * 17) % 35)}%`} height="11px" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, rIdx) => (
              <tr key={rIdx}>
                {Array.from({ length: columns }).map((__, cIdx) => (
                  <td key={cIdx} style={{ padding: '0.55rem 0.6rem' }}>
                    <SkeletonBlock
                      width={`${50 + (((rIdx + cIdx) * 23) % 45)}%`}
                      height="13px"
                      borderRadius="4px"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

export const SkeletonDashboard = memo(function SkeletonDashboard({ kpiCount = 10, progress = null }) {
  return (
    <div className="animate-fade-in w-100" role="status" aria-busy="true" aria-label="Cargando panel ejecutivo">
      {progress && <LoadProgressBanner progress={progress} />}
      <SkeletonKpiGrid count={kpiCount} />
      <div className="row g-3 mb-3">
        <div className="col-lg-7">
          <div className="card-premium h-100 p-3">
            <SkeletonBlock width="55%" height="18px" className="mb-3" />
            <SkeletonTable rows={6} columns={6} />
          </div>
        </div>
        <div className="col-lg-5">
          <div className="card-premium h-100 p-3">
            <SkeletonBlock width="50%" height="18px" className="mb-3" />
            <SkeletonBlock width="100%" height="58px" borderRadius="8px" className="mb-2" />
            <SkeletonBlock width="100%" height="58px" borderRadius="8px" className="mb-2" />
            <SkeletonBlock width="100%" height="58px" borderRadius="8px" />
          </div>
        </div>
      </div>
    </div>
  );
});

export const LoadProgressBanner = memo(function LoadProgressBanner({ progress }) {
  if (!progress) return null;
  const loaded = Number(progress.loaded || 0);
  const total = Number(progress.total || 0);
  const isProcessing = progress.phase === 'processing';
  const pct = isProcessing
    ? 98
    : total > 0
      ? Math.min(96, Math.max(4, Math.round((loaded / total) * 96)))
      : 12;

  const label = isProcessing
    ? `Procesando y validando ${loaded.toLocaleString('es-PE')} comprobantes...`
    : total > 0
      ? `Descargando comprobantes: ${loaded.toLocaleString('es-PE')} / ${total.toLocaleString('es-PE')} (${Math.round((loaded / total) * 100)}%)`
      : 'Consultando período en Supabase...';

  return (
    <div className="card-premium p-3 mb-3" role="status" aria-live="polite">
      <div className="d-flex justify-content-between align-items-center mb-2 gap-2">
        <span className="fw-semibold" style={{ fontSize: '0.84rem', color: 'var(--color-text)' }}>
          {label}
        </span>
        <span className="font-mono text-primary fw-bold" style={{ fontSize: '0.8rem' }}>
          {total > 0 || isProcessing ? `${isProcessing ? 99 : Math.round((loaded / Math.max(1, total)) * 100)}%` : '...'}
        </span>
      </div>
      <div
        className="w-100 rounded-pill overflow-hidden"
        style={{ height: '7px', backgroundColor: 'rgba(148, 163, 184, 0.22)' }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: 'linear-gradient(90deg, #2563EB 0%, #3B82F6 100%)',
            transition: 'width 0.25s ease',
          }}
        />
      </div>
    </div>
  );
});

export const LoadErrorAlert = memo(function LoadErrorAlert({ title = 'No se pudieron cargar los datos', error, onRetry }) {
  const detail = error?.message || 'Tiempo de espera agotado o error de conexión con el servidor.';
  return (
    <div
      className="card-premium p-4 my-2 d-flex flex-column flex-sm-row align-items-start align-items-sm-center justify-content-between gap-3"
      role="alert"
      style={{ borderColor: 'rgba(220, 38, 38, 0.35)', backgroundColor: 'rgba(254, 242, 242, 0.7)' }}
    >
      <div>
        <div className="fw-bold text-danger mb-1" style={{ fontSize: '0.92rem' }}>
          {title}
        </div>
        <div className="text-muted" style={{ fontSize: '0.82rem' }}>
          {detail}
        </div>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="btn btn-sm btn-danger px-3 py-1.5 rounded-3 fw-semibold flex-shrink-0"
          style={{ cursor: 'pointer' }}
        >
          Reintentar
        </button>
      )}
    </div>
  );
});

export const SkeletonAppShell = memo(function SkeletonAppShell() {
  return (
    <div className="d-flex min-vh-100 w-100" style={{ backgroundColor: 'var(--bg-primary)' }} role="status" aria-busy="true">
      <div
        className="d-none d-lg-flex flex-column p-3"
        style={{ width: '210px', backgroundColor: 'var(--bg-surface)', borderRight: '1px solid var(--border-color)' }}
      >
        <div className="d-flex align-items-center mb-4">
          <SkeletonBlock width="38px" height="38px" borderRadius="10px" className="me-2" />
          <div className="flex-grow-1">
            <SkeletonBlock width="85%" height="14px" className="mb-1" />
            <SkeletonBlock width="60%" height="10px" />
          </div>
        </div>
        <SkeletonBlock width="100%" height="34px" borderRadius="8px" className="mb-2" />
        <SkeletonBlock width="100%" height="34px" borderRadius="8px" className="mb-2" />
        <SkeletonBlock width="100%" height="34px" borderRadius="8px" className="mb-2" />
        <SkeletonBlock width="100%" height="34px" borderRadius="8px" />
      </div>
      <div className="flex-grow-1 p-4">
        <div className="d-flex justify-content-between align-items-center mb-4 pb-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div>
            <SkeletonBlock width="240px" height="22px" className="mb-2" />
            <SkeletonBlock width="180px" height="12px" />
          </div>
          <div className="d-flex gap-2">
            <SkeletonBlock width="190px" height="48px" borderRadius="10px" />
            <SkeletonBlock width="170px" height="48px" borderRadius="10px" />
          </div>
        </div>
        <SkeletonDashboard kpiCount={4} />
      </div>
    </div>
  );
});

export default SkeletonTable;
