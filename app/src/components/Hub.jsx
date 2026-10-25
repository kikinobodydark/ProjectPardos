import React, { useState, useRef, useEffect } from 'react';
import { 
  FiTrendingUp, 
  FiTruck, 
  FiSliders, 
  FiBriefcase, 
  FiLogOut,
  FiChevronDown,
  FiArrowRight,
  FiCheck,
  FiRepeat,
  FiCalendar,
  FiLock
} from 'react-icons/fi';
import './Hub.css';

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

  // Cerrar dropdown al hacer click fuera
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

  // Iniciales del usuario para el avatar
  const getInitials = (name) => {
    if (!name) return 'US';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  // Fecha actual formateada en español
  const formattedDate = (() => {
    try {
      const d = new Date().toLocaleDateString('es-PE', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
      return d.charAt(0).toUpperCase() + d.slice(1);
    } catch {
      return 'Fecha Actual';
    }
  })();

  // Saludo contextual según la hora del día
  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Buenos días';
    if (hour < 19) return 'Buenas tardes';
    return 'Buenas noches';
  })();

  // Definición de Módulos del Hub
  const cards = [
    {
      id: 'ventas',
      title: 'Conciliación de Ventas',
      badge: 'RVIE • SUNAT • SAP',
      badgeBg: 'rgba(16, 185, 129, 0.1)',
      badgeColor: '#059669',
      badgeBorder: 'rgba(16, 185, 129, 0.25)',
      description: 'Cruce tridireccional de registros RVIE (SUNAT), SIRE y SAP mediante cálculo de CAR. Validación automática de cortesías y detección de inconsistencias.',
      chips: ['Cruce 3 Vías', 'Cálculo CAR', 'Detección Cortesías', 'Validación RUC/DNI', 'Reportes Excel'],
      icon: <FiTrendingUp />,
      color: '#10B981',
      bgColor: 'rgba(16, 185, 129, 0.1)',
      active: true,
      ctaText: 'Acceder a Ventas'
    },
    {
      id: 'compras',
      title: 'Gestión de Compras',
      badge: 'RCE • SIRE Compras',
      badgeBg: 'rgba(139, 92, 246, 0.1)',
      badgeColor: '#7C3AED',
      badgeBorder: 'rgba(139, 92, 246, 0.25)',
      description: 'Auditoría del Registro de Compras Electrónico (RCE), cotejo de propuestas SUNAT con compras SAP y control de comprobantes con crédito fiscal.',
      chips: ['RCE SUNAT', 'Órdenes de Compra', 'Validación Proveedores', 'Control Detracciones'],
      icon: <FiTruck />,
      color: '#8B5CF6',
      bgColor: 'rgba(139, 92, 246, 0.1)',
      active: true,
      ctaText: 'Acceder a Compras'
    },
    {
      id: 'configuracion',
      title: 'Configuración Global',
      badge: isAdmin ? 'Acceso Administrador' : 'Solo Administradores',
      badgeBg: isAdmin ? 'rgba(37, 99, 235, 0.1)' : '#F1F5F9',
      badgeColor: isAdmin ? '#2563EB' : '#64748B',
      badgeBorder: isAdmin ? 'rgba(37, 99, 235, 0.25)' : '#E2E8F0',
      description: 'Administración de empresas asociadas, gestión de operadores, asignación de permisos multi-tenant y revalidación masiva de reglas contables.',
      chips: ['Multi-empresa', 'Usuarios & Roles', 'Auditoría RLS', 'Revalidación Reglas'],
      icon: <FiSliders />,
      color: '#3B82F6',
      bgColor: 'rgba(59, 130, 246, 0.1)',
      active: isAdmin,
      ctaText: isAdmin ? 'Administrar Sistema' : 'Requiere Rol Admin'
    }
  ];

  return (
    <div className="hub-wrapper">
      <div className="hub-container">
        
        {/* Cabecera Principal / Header */}
        <header className="hub-header">
          <div className="hub-brand-group">
            <div className="hub-brand-logo" title="ConciliaTributo - Pardos Chicken">
              CT
            </div>
            <div>
              <h1 className="hub-brand-title">
                ConciliaTributo
                <span className="hub-brand-badge">Pardos Chicken</span>
              </h1>
              <p className="hub-brand-subtitle">
                Sistema Integrado de Auditoría y Conciliación Tributaria RVIE • SUNAT • SAP
              </p>
            </div>
          </div>

          {/* Perfil del Usuario y Acciones */}
          <div className="hub-user-group">
            <div className="hub-user-pill">
              <div className="hub-user-avatar">
                {getInitials(userProfile?.nombre)}
              </div>
              <div className="hub-user-meta">
                <span className="hub-user-name">
                  {userProfile?.nombre || 'Usuario Pardos'}
                </span>
                <span className="hub-user-role-badge">
                  <span className="hub-user-role-dot" />
                  {userProfile?.rol || 'Operador'}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={onLogout}
              className="hub-logout-btn"
              title="Finalizar sesión en el sistema"
            >
              <FiLogOut />
              <span>Cerrar sesión</span>
            </button>
          </div>
        </header>

        {/* Tarjeta Contextual: Selector Multi-tenant */}
        <div className="hub-context-card">
          <div className="hub-company-info">
            <div className="hub-company-icon-box">
              <FiBriefcase />
            </div>
            <div>
              <div className="hub-company-tag">Empresa Activa en Sesión</div>
              <div className="hub-company-name-row">
                <span className="hub-company-name">
                  {activeCompany?.razon_social || 'Empresa no asignada'}
                </span>
                {activeCompany?.ruc && (
                  <span className="hub-company-ruc-badge" title="RUC registrado">
                    RUC: {activeCompany.ruc}
                  </span>
                )}

                {/* Dropdown de Cambio de Empresa para Administradores */}
                {isAdmin && companies.length > 1 && (
                  <div className="dropdown-premium d-inline-block ms-md-2" ref={dropdownRef}>
                    <button
                      type="button"
                      className="hub-change-company-btn"
                      onClick={() => setShowCompanyDropdown(!showCompanyDropdown)}
                      aria-expanded={showCompanyDropdown}
                    >
                      <FiRepeat />
                      <span>Cambiar Empresa</span>
                      <FiChevronDown />
                    </button>

                    <ul 
                      className={`dropdown-premium-menu ${showCompanyDropdown ? 'show' : ''}`}
                      style={{ minWidth: '320px', left: 0, marginTop: '8px', zIndex: 1050 }}
                    >
                      <div className="px-3 py-2 border-bottom text-muted fw-bold" style={{ fontSize: '0.75rem', letterSpacing: '0.05em' }}>
                        EMPRESAS DISPONIBLES ({companies.length})
                      </div>
                      {companies.map((c) => {
                        const isSelected = c.id === activeCompany?.id;
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
                              <div className="text-truncate me-2">
                                <div className="fw-semibold text-truncate">{c.razon_social}</div>
                                {c.ruc && (
                                  <small className="text-muted font-mono" style={{ fontSize: '0.75rem' }}>
                                    RUC: {c.ruc}
                                  </small>
                                )}
                              </div>
                              {isSelected && <FiCheck className="text-primary flex-shrink-0" />}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="hub-context-meta">
            <div className="hub-meta-item" title="Fecha del sistema">
              <FiCalendar />
              <span>{formattedDate}</span>
            </div>
          </div>
        </div>

        {/* Sección de Selección de Módulo */}
        <div className="hub-section-header">
          <h2 className="hub-section-title">
            {greeting}, {userProfile?.nombre?.split(' ')[0] || 'Administrador'}
          </h2>
          <p className="hub-section-desc">
            Selecciona el entorno de trabajo para iniciar la conciliación o administración de comprobantes:
          </p>
        </div>

        {/* Grid de Tarjetas de Módulos (Full Width) */}
        <div className="hub-cards-grid">
          {cards.map((card) => {
            const isClickable = card.active;
            return (
              <div
                key={card.id}
                role="button"
                tabIndex={isClickable ? 0 : -1}
                aria-disabled={!isClickable}
                onClick={() => isClickable && onSelectModule(card.id)}
                onKeyDown={(e) => {
                  if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onSelectModule(card.id);
                  }
                }}
                className={`hub-card ${isClickable ? 'hub-card-active' : 'hub-card-disabled'}`}
              >
                {/* Barra de Acento Superior */}
                <div 
                  className="hub-card-accent-bar" 
                  style={{ backgroundColor: card.color }} 
                />

                <div>
                  {/* Fila Superior: Badge del Módulo */}
                  <div className="hub-card-top-row">
                    <span 
                      className="hub-card-status-badge"
                      style={{ 
                        backgroundColor: card.badgeBg,
                        color: card.badgeColor,
                        border: `1px solid ${card.badgeBorder}`
                      }}
                    >
                      {card.badge}
                    </span>
                  </div>

                  {/* Icono con Contenedor Estilizado */}
                  <div 
                    className="hub-card-icon-wrapper"
                    style={{ 
                      backgroundColor: card.bgColor, 
                      color: card.color 
                    }}
                  >
                    {card.icon}
                  </div>

                  {/* Título y Descripción Rica */}
                  <h3 className="hub-card-title">
                    {card.title}
                  </h3>
                  <p className="hub-card-description">
                    {card.description}
                  </p>

                  {/* Tags / Chips de Capacidades */}
                  <div className="hub-card-chips">
                    {card.chips.map((chip, idx) => (
                      <span key={idx} className="hub-card-chip">
                        {chip}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Footer de Tarjeta con Acción Interactiva */}
                <div className="hub-card-footer">
                  {isClickable ? (
                    <span 
                      className="hub-card-cta-btn" 
                      style={{ color: card.color }}
                    >
                      {card.ctaText}
                      <FiArrowRight />
                    </span>
                  ) : (
                    <span 
                      className="text-muted d-inline-flex align-items-center gap-1"
                      style={{ fontSize: '0.85rem' }}
                    >
                      <FiLock style={{ fontSize: '0.85rem' }} />
                      {card.ctaText}
                    </span>
                  )}

                  <span 
                    className="text-muted" 
                    style={{ fontSize: '0.8rem', fontWeight: 500 }}
                  >
                    {isClickable ? 'Disponible' : 'Bloqueado'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
