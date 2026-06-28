import React from 'react';
import { FiBriefcase, FiCalendar } from 'react-icons/fi';

export default function Navbar({ activeCompany, activePeriod }) {
  return (
    <div 
      className="d-flex justify-content-between align-items-center mb-4 pb-3 animate-fade-in"
      style={{ borderBottom: '1px solid var(--border-color)' }}
    >
      <div>
        <h4 className="fw-bold mb-0 text-white" style={{ letterSpacing: '-0.02em' }}>
          Consolidación y Conciliación
        </h4>
        <p className="text-muted mb-0" style={{ fontSize: '0.85rem' }}>
          Sistema Integrado de Auditoría Tributaria Perú
        </p>
      </div>

      <div className="d-flex align-items-center gap-3">
        {activeCompany && (
          <div 
            className="d-flex align-items-center px-3 py-2 rounded-3" 
            style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}
          >
            <FiBriefcase className="text-primary me-2 fs-5" />
            <div style={{ fontSize: '0.85rem' }}>
              <div className="fw-semibold text-white text-truncate" style={{ maxWidth: '240px' }}>
                {activeCompany.razon_social}
              </div>
              <div className="text-muted font-mono" style={{ fontSize: '0.75rem' }}>
                RUC: {activeCompany.ruc}
              </div>
            </div>
          </div>
        )}

        {activePeriod && (
          <div 
            className="d-flex align-items-center px-3 py-2 rounded-3" 
            style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}
          >
            <FiCalendar className="text-success me-2 fs-5" />
            <div style={{ fontSize: '0.85rem' }}>
              <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                PERÍODO SELECCIONADO
              </div>
              <div className="fw-bold text-success font-mono" style={{ fontSize: '0.85rem' }}>
                {activePeriod.slice(0, 4)}-{activePeriod.slice(4)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
