import React, { useState, useEffect, useRef } from 'react';
import { FiBriefcase, FiCalendar, FiMenu, FiChevronDown } from 'react-icons/fi';

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
          className="btn btn-outline-secondary d-lg-none me-2 border-0 p-1 d-flex align-items-center justify-content-center"
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
            ref={companyRef}
            className={`d-flex align-items-center px-3 py-2 rounded-3 position-relative select-none ${userRole === 'admin' && companies.length > 1 ? 'cursor-pointer' : ''}`}
            style={{ 
              backgroundColor: 'var(--bg-surface)', 
              border: '1px solid var(--border-color)', 
              minHeight: '54px',
              transition: 'all 0.2s ease',
              cursor: userRole === 'admin' && companies.length > 1 ? 'pointer' : 'default'
            }}
            onClick={() => {
              if (userRole === 'admin' && companies.length > 1) {
                setShowCompanyDropdown(!showCompanyDropdown);
              }
            }}
          >
            <FiBriefcase className="text-primary me-2 fs-5 flex-shrink-0" />
            <div style={{ fontSize: '0.85rem', minWidth: '180px', maxWidth: '260px' }}>
              <div className="fw-semibold text-truncate text-start" style={{ color: 'var(--color-text)' }}>
                {activeCompany.razon_social}
              </div>
              <div className="text-muted font-mono text-start" style={{ fontSize: '0.75rem', marginTop: '2px' }}>
                RUC: {activeCompany.ruc}
              </div>
            </div>

            {userRole === 'admin' && companies.length > 1 && (
              <FiChevronDown 
                className="ms-3 text-muted fs-6 flex-shrink-0" 
                style={{ 
                  transform: showCompanyDropdown ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s ease'
                }} 
              />
            )}

            {/* Menú Dropdown */}
            {userRole === 'admin' && companies.length > 1 && (
              <ul 
                className={`dropdown-premium-menu ${showCompanyDropdown ? 'show' : ''}`} 
                style={{ right: 0, left: 'auto', marginTop: '4px' }}
                onClick={(e) => e.stopPropagation()}
              >
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
            )}
          </div>
        )}

        {activeCompany && (
          <div 
            ref={periodRef}
            className={`d-flex align-items-center px-3 py-2 rounded-3 position-relative select-none ${periods.length > 0 ? 'cursor-pointer' : ''}`}
            style={{ 
              backgroundColor: 'var(--bg-surface)', 
              border: '1px solid var(--border-color)', 
              minHeight: '54px',
              transition: 'all 0.2s ease',
              cursor: periods.length > 0 ? 'pointer' : 'default'
            }}
            onClick={() => {
              if (periods.length > 0) {
                setShowPeriodDropdown(!showPeriodDropdown);
              }
            }}
          >
            <FiCalendar className="text-success me-2 fs-5 flex-shrink-0" />
            <div style={{ fontSize: '0.85rem', minWidth: '130px', maxWidth: '260px' }}>
              <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                PERÍODO SELECCIONADO
              </div>
              <div className="fw-bold text-success font-mono text-start" style={{ marginTop: '2px' }}>
                {activePeriod
                  ? (activePeriod.includes('(') || activePeriod.includes('-') 
                     ? activePeriod 
                     : `${activePeriod.slice(0, 4)}-${activePeriod.slice(4)}`)
                  : 'Seleccionar...'}
              </div>
            </div>

            {periods.length > 0 && (
              <FiChevronDown 
                className="ms-3 text-muted fs-6 flex-shrink-0" 
                style={{ 
                  transform: showPeriodDropdown ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s ease'
                }} 
              />
            )}

            {/* Menú Dropdown de Períodos */}
            {periods.length > 0 && (
              <ul 
                className={`dropdown-premium-menu ${showPeriodDropdown ? 'show' : ''}`} 
                style={{ right: 0, left: 'auto', marginTop: '4px' }}
                onClick={(e) => e.stopPropagation()}
              >
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
            )}
          </div>
        )}
      </div>
    </div>
  );
}
