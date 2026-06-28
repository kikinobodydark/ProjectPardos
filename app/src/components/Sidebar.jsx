import React from 'react';
import { 
  FiLayout, 
  FiUploadCloud, 
  FiList, 
  FiClock, 
  FiBriefcase, 
  FiUsers, 
  FiLogOut 
} from 'react-icons/fi';

export default function Sidebar({ activeTab, setActiveTab, userProfile, onLogout }) {
  const isAdmin = userProfile?.rol === 'admin';

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
    <div className="sidebar animate-fade-in">
      <div className="d-flex align-items-center mb-4 px-2">
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
          <small className="text-muted" style={{ fontSize: '0.75rem' }}>v1.0.0 (SIRE)</small>
        </div>
      </div>

      <hr style={{ borderColor: 'var(--border-color)', margin: '1rem 0' }} />

      <div className="nav flex-column nav-pills mb-auto">
        <span className="text-muted fw-bold mb-2 px-2" style={{ fontSize: '0.7rem', uppercase: 'true', letterSpacing: '0.05em' }}>
          MENÚ PRINCIPAL
        </span>
        {menuItems
          .filter(item => !item.roles || item.roles.includes(userProfile?.rol))
          .map(item => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
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

        {isAdmin && (
          <>
            <span className="text-muted fw-bold mt-4 mb-2 px-2" style={{ fontSize: '0.7rem', uppercase: 'true', letterSpacing: '0.05em' }}>
              CONFIGURACIÓN
            </span>
            {adminItems.map(item => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
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
