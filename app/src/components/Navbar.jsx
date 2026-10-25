import React, { useState, useEffect, useRef } from 'react';
import { FiBriefcase, FiCalendar, FiMenu, FiChevronDown, FiCheck } from 'react-icons/fi';

export default function Navbar({ 
  activeCompany, 
  activePeriod, 
  onToggleSidebar, 
  companies = [], 
  onChangeCompany, 
  periods = [], 
  periodId, 
  onChangePeriod,
  activeModule
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

  const moduleName = activeModule === 'compras' 
    ? 'Gestión de Compras (RCE)' 
    : activeModule === 'configuracion'
      ? 'Configuración & Seguridad'
      : 'Conciliación de Ventas (RVIE)';

  return (
    <div 
      className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center mb-4 pb-3 animate-fade-in gap-3"
      style={{ borderBottom: '1px solid var(--border-color)', position: 'relative', zIndex: 100 }}
    >
      <div className="d-flex align-items-center">
        {/* Botón hamburguesa sólo visible en móvil */}
        <button 
          type="button"
          className="btn btn-outline-secondary d-lg-none me-2 border-0 p-1 d-flex align-items-center justify-content-center"
          onClick={onToggleSidebar}
          style={{ cursor: 'pointer' }}
          aria-label="Abrir navegación lateral"
        >
          <FiMenu className="fs-3 text-muted" />
        </button>
        <div>
          <div className="d-flex align-items-center gap-2">
            <h4 className="fw-bold mb-0" style={{ letterSpacing: '-0.02em', color: 'var(--color-text)' }}>
              {moduleName}
            </h4>
          </div>
          <p className="text-muted mb-0" style={{ fontSize: '0.82rem' }}>
            Consolidación y Auditoría Tributaria Perú • SUNAT • SAP
          </p>
        </div>
      </div>

      <div className="d-flex align-items-center gap-2 flex-wrap w-100 w-md-auto justify-content-start justify-content-md-end">
        {activeCompany && (
          <div 
            ref={companyRef}
            className={`d-flex align-items-center px-3 py-2 rounded-3 position-relative select-none ${companies.length > 1 ? 'cursor-pointer' : ''}`}
            style={{ 
              backgroundColor: 'var(--bg-surface)', 
              border: '1px solid var(--border-color)', 
              minHeight: '50px',
              transition: 'all 0.2s ease',
              cursor: companies.length > 1 ? 'pointer' : 'default',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
            }}
            onClick={() => {
              if (companies.length > 1) {
                setShowCompanyDropdown(!showCompanyDropdown);
              }
            }}
          >
            <div 
              className="d-flex align-items-center justify-content-center rounded-2 me-2.5 flex-shrink-0"
              style={{ width: '32px', height: '32px', backgroundColor: 'rgba(37, 99, 235, 0.08)', color: '#2563EB' }}
            >
              <FiBriefcase style={{ fontSize: '1.05rem' }} />
            </div>
            <div style={{ fontSize: '0.82rem', minWidth: '150px', maxWidth: '240px' }}>
              <div className="fw-bold text-truncate text-start" style={{ color: 'var(--color-text)' }}>
                {activeCompany.razon_social}
              </div>
              <div className="text-muted font-mono text-start" style={{ fontSize: '0.72rem' }}>
                RUC: {activeCompany.ruc}
              </div>
            </div>

            {companies.length > 1 && (
              <FiChevronDown 
                className="ms-2 text-muted fs-6 flex-shrink-0" 
                style={{ 
                  transform: showCompanyDropdown ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s ease'
                }} 
              />
            )}

            {/* Menú Dropdown de Empresas */}
            {companies.length > 1 && (
              <ul 
                className={`dropdown-premium-menu ${showCompanyDropdown ? 'show' : ''}`} 
                style={{ right: 0, left: 'auto', marginTop: '6px', minWidth: '280px' }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-3 py-2 border-bottom text-muted fw-bold" style={{ fontSize: '0.72rem', letterSpacing: '0.04em' }}>
                  CAMBIAR EMPRESA
                </div>
                {companies.map(c => {
                  const isSelected = c.id === activeCompany.id;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        className={`dropdown-premium-item d-flex align-items-center justify-content-between ${isSelected ? 'active' : ''}`}
                        onClick={() => {
                          if (onChangeCompany) onChangeCompany(c.id);
                          setShowCompanyDropdown(false);
                        }}
                      >
                        <div className="text-truncate me-2 text-start">
                          <div className="fw-semibold text-truncate">{c.razon_social}</div>
                          {c.ruc && <small className="text-muted font-mono" style={{ fontSize: '0.72rem' }}>RUC: {c.ruc}</small>}
                        </div>
                        {isSelected && <FiCheck className="text-primary flex-shrink-0" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Selector de Período (para ventas y compras) */}
        {activeCompany && activeModule !== 'configuracion' && (
          <div 
            ref={periodRef}
            className={`d-flex align-items-center px-3 py-2 rounded-3 position-relative select-none ${periods.length > 0 ? 'cursor-pointer' : ''}`}
            style={{ 
              backgroundColor: 'var(--bg-surface)', 
              border: '1px solid var(--border-color)', 
              minHeight: '50px',
              transition: 'all 0.2s ease',
              cursor: periods.length > 0 ? 'pointer' : 'default',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
            }}
            onClick={() => {
              if (periods.length > 0) {
                setShowPeriodDropdown(!showPeriodDropdown);
              }
            }}
          >
            <div 
              className="d-flex align-items-center justify-content-center rounded-2 me-2.5 flex-shrink-0"
              style={{ width: '32px', height: '32px', backgroundColor: 'rgba(16, 185, 129, 0.08)', color: '#059669' }}
            >
              <FiCalendar style={{ fontSize: '1.05rem' }} />
            </div>
            <div style={{ fontSize: '0.82rem', minWidth: '130px', maxWidth: '240px' }}>
              <div className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                PERÍODO ACTIVO
              </div>
              <div className="fw-bold font-mono text-start" style={{ color: '#059669' }}>
                {activePeriod
                  ? (activePeriod.includes('(') || activePeriod.includes('-') 
                     ? activePeriod 
                     : `${activePeriod.slice(0, 4)}-${activePeriod.slice(4)}`)
                  : 'Sin Período Seleccionado'}
              </div>
            </div>

            {periods.length > 0 && (
              <FiChevronDown 
                className="ms-2 text-muted fs-6 flex-shrink-0" 
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
                style={{ right: 0, left: 'auto', marginTop: '6px', minWidth: '240px' }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-3 py-2 border-bottom text-muted fw-bold" style={{ fontSize: '0.72rem', letterSpacing: '0.04em' }}>
                  PERÍODOS DISPONIBLES ({periods.length})
                </div>
                {periods.map(p => {
                  let label = p.periodo.slice(0, 4) + '-' + p.periodo.slice(4);
                  if (p.dia) {
                    label += ` (Día: ${p.dia}, v${p.version || 1})`;
                  }
                  const isSelected = p.id === periodId;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        className={`dropdown-premium-item font-mono d-flex align-items-center justify-content-between ${isSelected ? 'active' : ''}`}
                        onClick={() => {
                          if (onChangePeriod) onChangePeriod(p.id);
                          setShowPeriodDropdown(false);
                        }}
                      >
                        <span>{label}</span>
                        {isSelected && <FiCheck className="text-success flex-shrink-0" />}
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
