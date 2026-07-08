import React, { useState, useRef, useEffect } from 'react';
import { 
  FiTrendingUp, 
  FiPackage, 
  FiInbox, 
  FiUsers, 
  FiSettings, 
  FiTruck, 
  FiCheckSquare, 
  FiBriefcase, 
  FiUser, 
  FiArrowUpRight, 
  FiLogOut,
  FiChevronDown
} from 'react-icons/fi';

export default function Hub({ 
  userProfile, 
  activeCompany, 
  companies = [], 
  onChangeCompany, 
  onLogout, 
  onSelectModule 
}) {
  const [showCompanyDropdown, setShowCompanyDropdown] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowCompanyDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isAdmin = userProfile?.rol === 'admin';

  // Tarjetas del Hub
  const cards = [
    {
      id: 'ventas',
      title: 'Ventas',
      description: 'Cruce, conciliación y validación del Registro de Ventas e Ingresos (RVIE) con SAP y propuesta.',
      icon: <FiTrendingUp />,
      color: '#10B981', // Emerald green
      bgColor: 'rgba(16, 185, 129, 0.1)',
      active: true
    },
    {
      id: 'compras',
      title: 'Compras',
      description: 'Central de abastecimiento, gestión de OC/OS y control de compras.',
      icon: <FiTruck />,
      color: '#8B5CF6', // Purple
      bgColor: 'rgba(139, 92, 246, 0.1)',
      active: true
    },
    {
      id: 'configuracion',
      title: 'Configuración',
      description: 'Gestión de usuarios, obras, frentes y especialidades del sistema.',
      icon: <FiSettings />,
      color: '#64748B', // Slate
      bgColor: 'rgba(100, 116, 139, 0.1)',
      active: isAdmin // Solo admins pueden entrar a configuración global
    }
  ];

  return (
    <div className="min-vh-100 py-5 px-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="container-fluid" style={{ maxWidth: '1400px' }}>
        {/* Cabecera Premium */}
        <div className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center mb-5 pb-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div>
            <div className="d-flex align-items-center mb-2">
              <h2 className="fw-bold mb-0 me-3" style={{ letterSpacing: '-0.03em', color: 'var(--color-text)', fontSize: '2.4rem' }}>
                Bienvenido / {userProfile?.nombre || 'Usuario'}
              </h2>
              <span 
                className="badge font-mono fw-bold" 
                style={{ 
                  backgroundColor: 'rgba(37, 99, 235, 0.1)', 
                  color: 'var(--accent-color)',
                  fontSize: '0.85rem',
                  padding: '0.4em 0.8em',
                  borderRadius: '12px',
                  textTransform: 'uppercase'
                }}
              >
                {userProfile?.rol || 'Rol'}
              </span>
            </div>
            
            {/* Selector de Empresa */}
            {activeCompany && (
              <div className="d-flex align-items-center mt-3 p-3 rounded-3 bg-white border border-light" style={{ width: 'fit-content' }}>
                <span className="text-danger me-2 d-flex align-items-center" style={{ fontSize: '1.2rem' }}>🏢</span>
                <span className="fw-semibold text-muted me-1" style={{ fontSize: '1.05rem' }}>Empresa:</span>
                <span className="fw-bold text-dark me-2" style={{ fontSize: '1.05rem' }}>
                  {activeCompany.razon_social}
                </span>
                
                {isAdmin && companies.length > 1 ? (
                  <div className="dropdown-premium d-inline-block" ref={dropdownRef}>
                    <button
                      type="button"
                      className="btn btn-sm btn-link text-decoration-none p-0 fw-bold"
                      style={{ fontSize: '0.95rem', color: '#EF4444', outline: 'none' }}
                      onClick={() => setShowCompanyDropdown(!showCompanyDropdown)}
                    >
                      (CAMBIAR) <FiChevronDown className="ms-1" />
                    </button>
                    <ul className={`dropdown-premium-menu ${showCompanyDropdown ? 'show' : ''}`} style={{ left: 0, marginTop: '8px' }}>
                      {companies.map(c => (
                        <li key={c.id}>
                          <button
                            type="button"
                            className={`dropdown-premium-item text-truncate ${c.id === activeCompany.id ? 'active' : ''}`}
                            onClick={() => {
                              if (onChangeCompany) onChangeCompany(c.id);
                              setShowCompanyDropdown(false);
                            }}
                            style={{ fontSize: '0.95rem' }}
                          >
                            {c.razon_social}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <button
            onClick={onLogout}
            className="btn btn-outline-danger d-flex align-items-center px-4 py-2.5 mt-3 mt-md-0 rounded-3 fw-bold"
            style={{ transition: 'all 0.2s ease', fontSize: '1rem' }}
          >
            <FiLogOut className="me-2" /> Cerrar sesión
          </button>
        </div>

        {/* Grid de Tarjetas (Cards) */}
        <div className="row g-4 justify-content-center">
          {cards.map(card => {
            const isClickable = card.active;
            return (
              <div key={card.id} className="col-12 col-md-6 col-lg-4 d-flex justify-content-center">
                <div 
                  onClick={() => isClickable && onSelectModule(card.id)}
                  className={`card-premium h-100 d-flex flex-column align-items-center justify-content-between p-5 text-center ${isClickable ? 'card-clickable' : ''}`}
                  style={{
                    opacity: isClickable ? 1 : 0.6,
                    cursor: isClickable ? 'pointer' : 'default',
                    borderTop: isClickable ? `4px solid ${card.color}` : '1px solid var(--border-color)',
                    transition: 'all 0.2s ease',
                    position: 'relative',
                    minHeight: '280px',
                    width: '100%',
                    maxWidth: '360px'
                  }}
                >
                  <div className="d-flex flex-column align-items-center">
                    {/* Icono con background circular */}
                    <div 
                      className="d-flex align-items-center justify-content-center rounded-circle mb-4"
                      style={{ 
                        width: '80px', 
                        height: '80px', 
                        backgroundColor: card.bgColor,
                        color: card.color,
                        fontSize: '2.4rem'
                      }}
                    >
                      {card.icon}
                    </div>

                    <h4 className="fw-bold mb-0 text-dark" style={{ fontSize: '2rem' }}>
                      {card.title}
                    </h4>
                  </div>

                  <div className="d-flex justify-content-center align-items-center mt-auto pt-4">
                    {card.active ? (
                      <span className="fw-bold text-primary" style={{ fontSize: '1.25rem' }}>
                        Ingresar &rarr;
                      </span>
                    ) : (
                      <span 
                        className="badge font-mono" 
                        style={{ 
                          backgroundColor: '#F1F5F9', 
                          color: '#64748B', 
                          fontSize: '0.75rem',
                          padding: '0.4em 0.8em',
                          borderRadius: '8px'
                        }}
                      >
                        Próximamente
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
