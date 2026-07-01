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
  FiHome
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
  const isAdmin = userProfile?.rol === 'admin';
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

  return (
    <div className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="d-flex align-items-center justify-content-between mb-4 px-2">
        <div className="d-flex align-items-center">
          <div 
            className="bg-primary rounded-circle d-flex align-items-center justify-content-center me-2" 
            style={{ width: '40px', height: '40px', minWidth: '40px' }}
          >
            <span className="text-white fw-bold">CT</span>
          </div>
          <div>
            <h5 className="mb-0 fw-bold text-white" style={{ fontSize: '1rem', letterSpacing: '-0.02em' }}>
              ConciliaTributo
            </h5>
            <small className="text-muted" style={{ fontSize: '0.75rem' }}>v1.0.0</small>
          </div>
        </div>
        
        {/* Botón de cerrar sidebar en celular */}
        <button
          className="btn btn-sm btn-outline-secondary d-lg-none border-0 p-1"
          onClick={() => setSidebarOpen(false)}
          style={{ cursor: 'pointer' }}
        >
          <FiX className="fs-4 text-muted" />
        </button>
      </div>

      <hr style={{ borderColor: 'var(--border-color)', margin: '1rem 0' }} />

      <div className="nav flex-column nav-pills mb-auto">
        {activeModule && (
          <button
            onClick={() => {
              onReturnToHub();
              if (setSidebarOpen) setSidebarOpen(false);
            }}
            onMouseEnter={() => setBtnHover(true)}
            onMouseLeave={() => setBtnHover(false)}
            className="nav-link d-flex align-items-center mb-3 px-3 py-2 rounded-3 w-100 text-start"
            style={{
              transition: 'all 0.15s ease',
              fontWeight: '600',
              cursor: 'pointer',
              backgroundColor: btnHover ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.08)',
              border: btnHover ? '1px solid rgba(99, 102, 241, 0.45)' : '1px solid rgba(99, 102, 241, 0.25)',
              color: btnHover ? '#312E81' : '#4F46E5',
              boxShadow: 'none'
            }}
          >
            <span className="me-3 fs-5 d-flex align-items-center"><FiHome /></span>
            Regresar al Hub
          </button>
        )}

        {activeModule === 'configuracion' ? (
          <>
            <span className="text-muted fw-bold mb-2 px-2" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              CONFIGURACIÓN
            </span>
            {adminItems.map(item => (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  if (setSidebarOpen) setSidebarOpen(false);
                }}
                className={`nav-link text-start d-flex align-items-center mb-1 px-3 py-2 border-0 rounded-3 ${
                  activeTab === item.id 
                    ? 'bg-primary text-white' 
                    : 'text-muted bg-transparent'
                }`}
                style={{
                  transition: 'all 0.15s ease',
                  fontWeight: '500',
                  cursor: 'pointer'
                }}
              >
                <span className="me-3 fs-5 d-flex align-items-center">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </>
        ) : (
          <>
            <span className="text-muted fw-bold mb-2 px-2" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {activeModule === 'compras' ? 'MÓDULO COMPRAS' : 'MÓDULO VENTAS'}
            </span>
            {menuItems
              .filter(item => !item.roles || item.roles.includes(userProfile?.rol))
              .map(item => (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    if (setSidebarOpen) setSidebarOpen(false);
                  }}
                  className={`nav-link text-start d-flex align-items-center mb-1 px-3 py-2 border-0 rounded-3 ${
                    activeTab === item.id 
                      ? 'bg-primary text-white' 
                      : 'text-muted bg-transparent'
                  }`}
                  style={{
                    transition: 'all 0.15s ease',
                    fontWeight: '500',
                    cursor: 'pointer'
                  }}
                >
                  <span className="me-3 fs-5 d-flex align-items-center">{item.icon}</span>
                  {item.label}
                </button>
              ))}
          </>
        )}
      </div>

      <hr style={{ borderColor: 'var(--border-color)', margin: '1rem 0' }} />

      <div className="d-flex flex-column">
        <div className="d-flex align-items-center mb-3 px-2">
          <div 
            className="bg-secondary rounded-circle d-flex align-items-center justify-content-center me-2 text-white fw-bold" 
            style={{ width: '32px', height: '32px' }}
          >
            {userProfile?.nombre ? userProfile.nombre[0].toUpperCase() : 'U'}
          </div>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <div className="fw-semibold text-white text-truncate" style={{ fontSize: '0.85rem' }}>
              {userProfile?.nombre || 'Usuario'}
            </div>
            <div className="text-muted text-truncate" style={{ fontSize: '0.72rem' }}>
              {userProfile?.rol?.toUpperCase()}
            </div>
          </div>
        </div>

        <button
          onClick={onLogout}
          className="btn btn-outline-danger d-flex align-items-center justify-content-center w-100 py-2 rounded-3"
          style={{ fontSize: '0.85rem', fontWeight: '500' }}
        >
          <FiLogOut className="me-2" /> Cerrar Sesión
        </button>
      </div>
    </div>
  );
}
