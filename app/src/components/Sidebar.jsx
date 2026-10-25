import React, { useState } from 'react';
import { 
  FiLayout, 
  FiUploadCloud, 
  FiList, 
  FiClock, 
  FiBriefcase, 
  FiUsers, 
  FiLogOut,
  FiX,
  FiHome,
  FiChevronLeft
} from 'react-icons/fi';

export default function Sidebar({ 
  activeTab, 
  setActiveTab, 
  userProfile, 
  onLogout, 
  sidebarOpen, 
  setSidebarOpen,
  activeModule,
  onReturnToHub
}) {
  const [btnHover, setBtnHover] = useState(false);

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: <FiLayout /> },
    { id: 'upload', label: 'Carga TXT', icon: <FiUploadCloud />, roles: ['admin', 'operador'] },
    { id: 'reconciliation', label: 'Conciliación', icon: <FiList /> },
    { id: 'history', label: 'Historial', icon: <FiClock /> },
  ];

  const adminItems = [
    { id: 'companies', label: 'Empresas', icon: <FiBriefcase /> },
    { id: 'users', label: 'Usuarios', icon: <FiUsers /> },
  ];

  const getInitials = (name) => {
    if (!name) return 'U';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <div className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
      {/* Brand Header */}
      <div className="d-flex align-items-center justify-content-between mb-3 px-2">
        <div className="d-flex align-items-center">
          <div 
            className="rounded-3 d-flex align-items-center justify-content-center me-2" 
            style={{ 
              width: '38px', 
              height: '38px', 
              minWidth: '38px',
              background: 'linear-gradient(135deg, #1E293B 0%, #0F172A 100%)',
              color: '#FFFFFF',
              fontWeight: 800,
              fontSize: '1rem',
              letterSpacing: '-0.03em',
              boxShadow: '0 4px 8px -2px rgba(15, 23, 42, 0.25)'
            }}
          >
            CT
          </div>
          <div className="text-truncate">
            <h5 className="mb-0 fw-bold" style={{ fontSize: '0.98rem', letterSpacing: '-0.02em', color: 'var(--color-text)' }}>
              ConciliaTributo
            </h5>
            <small className="text-muted font-mono" style={{ fontSize: '0.72rem' }}>Pardos Chicken</small>
          </div>
        </div>
        
        {/* Botón de cerrar sidebar en celular */}
        <button
          className="btn btn-sm btn-outline-secondary d-lg-none border-0 p-1"
          onClick={() => setSidebarOpen(false)}
          style={{ cursor: 'pointer' }}
          aria-label="Cerrar navegación"
        >
          <FiX className="fs-4 text-muted" />
        </button>
      </div>

      <hr style={{ borderColor: 'var(--border-color)', margin: '0.75rem 0 1rem 0' }} />

      <div className="nav flex-column nav-pills mb-auto">
        {/* Regresar al Hub */}
        {activeModule && (
          <button
            type="button"
            onClick={() => {
              onReturnToHub();
              if (setSidebarOpen) setSidebarOpen(false);
            }}
            onMouseEnter={() => setBtnHover(true)}
            onMouseLeave={() => setBtnHover(false)}
            className="nav-link d-flex align-items-center mb-3 px-3 py-2 rounded-3 w-100 text-start"
            style={{
              transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
              fontWeight: '600',
              fontSize: '0.86rem',
              cursor: 'pointer',
              backgroundColor: btnHover ? 'rgba(37, 99, 235, 0.12)' : 'rgba(37, 99, 235, 0.06)',
              border: '1px solid rgba(37, 99, 235, 0.2)',
              color: '#2563EB',
              gap: '0.6rem'
            }}
          >
            <FiHome className="fs-5 flex-shrink-0" />
            <span className="flex-grow-1">Volver al Hub</span>
            <FiChevronLeft className="text-muted" style={{ fontSize: '0.8rem' }} />
          </button>
        )}

        {/* Sección Configuración */}
        {activeModule === 'configuracion' ? (
          <>
            <span className="text-muted fw-bold mb-2 px-2" style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              ADMINISTRACIÓN
            </span>
            {adminItems.map(item => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    if (setSidebarOpen) setSidebarOpen(false);
                  }}
                  className={`nav-link text-start d-flex align-items-center mb-1 px-3 py-2 border-0 rounded-3 ${
                    isActive 
                      ? 'bg-primary text-white shadow-sm' 
                      : 'text-muted bg-transparent hover-bg-surface'
                  }`}
                  style={{
                    transition: 'all 0.15s ease',
                    fontWeight: isActive ? '600' : '500',
                    fontSize: '0.88rem',
                    cursor: 'pointer'
                  }}
                >
                  <span className="me-3 fs-5 d-flex align-items-center">{item.icon}</span>
                  {item.label}
                </button>
              );
            })}
          </>
        ) : (
          <>
            <div className="d-flex align-items-center justify-content-between mb-2 px-2">
              <span className="text-muted fw-bold" style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {activeModule === 'compras' ? 'MÓDULO COMPRAS' : 'MÓDULO VENTAS'}
              </span>
              <span 
                className="badge font-mono" 
                style={{ 
                  fontSize: '0.65rem', 
                  backgroundColor: activeModule === 'compras' ? 'rgba(139, 92, 246, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                  color: activeModule === 'compras' ? '#7C3AED' : '#059669',
                  border: `1px solid ${activeModule === 'compras' ? 'rgba(139, 92, 246, 0.2)' : 'rgba(16, 185, 129, 0.2)'}`
                }}
              >
                {activeModule === 'compras' ? 'RCE' : 'RVIE'}
              </span>
            </div>
            {menuItems
              .filter(item => !item.roles || item.roles.includes(userProfile?.rol))
              .map(item => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      if (setSidebarOpen) setSidebarOpen(false);
                    }}
                    className={`nav-link text-start d-flex align-items-center mb-1 px-3 py-2 border-0 rounded-3 ${
                      isActive 
                        ? 'bg-primary text-white shadow-sm' 
                        : 'text-muted bg-transparent'
                    }`}
                    style={{
                      transition: 'all 0.15s ease',
                      fontWeight: isActive ? '600' : '500',
                      fontSize: '0.88rem',
                      cursor: 'pointer'
                    }}
                  >
                    <span className="me-3 fs-5 d-flex align-items-center">{item.icon}</span>
                    {item.label}
                  </button>
                );
              })}
          </>
        )}
      </div>

      <hr style={{ borderColor: 'var(--border-color)', margin: '1rem 0' }} />

      {/* User Footer */}
      <div className="d-flex flex-column">
        <div className="d-flex align-items-center mb-3 px-1">
          <div 
            className="rounded-circle d-flex align-items-center justify-content-center me-2 text-white fw-bold shadow-sm" 
            style={{ 
              width: '34px', 
              height: '34px', 
              minWidth: '34px',
              background: 'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)',
              fontSize: '0.82rem'
            }}
          >
            {getInitials(userProfile?.nombre)}
          </div>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <div className="fw-semibold text-truncate" style={{ fontSize: '0.86rem', color: 'var(--color-text)' }}>
              {userProfile?.nombre || 'Usuario'}
            </div>
            <div className="text-muted text-truncate font-mono" style={{ fontSize: '0.72rem' }}>
              {userProfile?.rol?.toUpperCase() || 'OPERADOR'}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="btn btn-outline-danger d-flex align-items-center justify-content-center w-100 py-2 rounded-3"
          style={{ fontSize: '0.84rem', fontWeight: '600', transition: 'all 0.2s ease' }}
        >
          <FiLogOut className="me-2" /> Cerrar Sesión
        </button>
      </div>
    </div>
  );
}
