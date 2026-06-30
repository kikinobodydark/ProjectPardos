import React, { useState, useEffect, useRef } from 'react';
import { FiBriefcase, FiCalendar, FiMenu } from 'react-icons/fi';

export default function Navbar({ 
  activeCompany, 
  activePeriod, 
  onToggleSidebar, 
  companies = [], 
  onChangeCompany, 
  userRole,
  periods = [],
  periodId,
  onChangePeriod
}) {
  const [showCompanyDropdown, setShowCompanyDropdown] = useState(false);
  const [showPeriodDropdown, setShowPeriodDropdown] = useState(false);

  const companyRef = useRef(null);
  const periodRef = useRef(null);

  // Click-away listener to close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (companyRef.current && !companyRef.current.contains(event.target)) {
        setShowCompanyDropdown(false);
      }
      if (periodRef.current && !periodRef.current.contains(event.target)) {
        setShowPeriodDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div 
      className="d-flex justify-content-between align-items-center mb-4 pb-3 animate-fade-in"
      style={{ borderBottom: '1px solid var(--border-color)', position: 'relative', zIndex: 100 }}
    >
      <div className="d-flex align-items-center">
        {/* Botón hamburguesa sólo visible en móvil */}
        <button 
          className="btn btn-outline-secondary d-md-none me-2 border-0 p-1 d-flex align-items-center justify-content-center"
          onClick={onToggleSidebar}
          style={{ cursor: 'pointer' }}
        >
          <FiMenu className="fs-3 text-muted" />
        </button>
        <div>
          <h4 className="fw-bold mb-0" style={{ letterSpacing: '-0.02em' }}>
            Consolidación y Conciliación
          </h4>
          <p className="text-muted mb-0" style={{ fontSize: '0.85rem' }}>
            Sistema Integrado de Auditoría Tributaria Perú
          </p>
        </div>
      </div>

      <div className="d-flex align-items-center gap-3">
        {activeCompany && (
          <div 
            className="d-flex align-items-center px-3 py-2 rounded-3" 
            style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', minHeight: '54px' }}
          >
            <FiBriefcase className="text-primary me-2 fs-5" />
            <div style={{ fontSize: '0.85rem' }}>
              {userRole === 'admin' && companies.length > 0 ? (
                <div className="dropdown-premium" ref={companyRef}>
                  <button
                    type="button"
                    className="dropdown-premium-toggle border-0 p-0 fw-semibold bg-transparent text-truncate text-start"
                    style={{ minWidth: '180px', maxWidth: '260px' }}
                    onClick={() => setShowCompanyDropdown(!showCompanyDropdown)}
                  >
                    {activeCompany.razon_social}
                  </button>
                  <ul className={`dropdown-premium-menu ${showCompanyDropdown ? 'show' : ''}`} style={{ right: 0, left: 'auto' }}>
                    {companies.map(c => (
                      <li key={c.id}>
                        <button
                          type="button"
                          className={`dropdown-premium-item text-truncate ${c.id === activeCompany.id ? 'active' : ''}`}
                          style={{ maxWidth: '280px' }}
                          onClick={() => {
                            if (onChangeCompany) onChangeCompany(c.id);
                            setShowCompanyDropdown(false);
                          }}
                        >
                          {c.razon_social}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="text-muted font-mono" style={{ fontSize: '0.75rem', marginTop: '2px' }}>
                    RUC: {activeCompany.ruc}
                  </div>
                </div>
              ) : (
                <>
                  <div className="fw-semibold text-truncate" style={{ maxWidth: '240px' }}>
                    {activeCompany.razon_social}
                  </div>
                  <div className="text-muted font-mono" style={{ fontSize: '0.75rem' }}>
                    RUC: {activeCompany.ruc}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {activeCompany && (
          <div 
            className="d-flex align-items-center px-3 py-2 rounded-3" 
            style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', minHeight: '54px' }}
          >
            <FiCalendar className="text-success me-2 fs-5" />
            <div style={{ fontSize: '0.85rem' }}>
              <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                PERÍODO SELECCIONADO
              </div>
              {periods.length > 0 ? (
                <div className="dropdown-premium" ref={periodRef}>
                  <button
                    type="button"
                    className="dropdown-premium-toggle border-0 p-0 fw-bold text-success font-mono bg-transparent text-start"
                    style={{ minWidth: '130px', maxWidth: '260px' }}
                    onClick={() => setShowPeriodDropdown(!showPeriodDropdown)}
                  >
                    {activePeriod
                      ? (activePeriod.includes('(') || activePeriod.includes('-') 
                         ? activePeriod 
                         : `${activePeriod.slice(0, 4)}-${activePeriod.slice(4)}`)
                      : 'Seleccionar...'}
                  </button>
                  <ul className={`dropdown-premium-menu ${showPeriodDropdown ? 'show' : ''}`} style={{ right: 0, left: 'auto' }}>
                    {periods.map(p => {
                      let label = p.periodo.slice(0, 4) + '-' + p.periodo.slice(4);
                      if (p.dia) {
                        label += ` (Día: ${p.dia}, v${p.version || 1})`;
                      }
                      return (
                        <li key={p.id}>
                          <button
                            type="button"
                            className={`dropdown-premium-item font-mono ${p.id === periodId ? 'active' : ''}`}
                            onClick={() => {
                              if (onChangePeriod) onChangePeriod(p.id);
                              setShowPeriodDropdown(false);
                            }}
                          >
                            {label}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                <div className="fw-semibold text-muted font-mono" style={{ fontSize: '0.85rem' }}>
                  Sin períodos cargados
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
