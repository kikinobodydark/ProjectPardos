import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './utils/supabaseClient';
import {
  enforceHttps,
  getOrCreateCsrfToken,
  checkAndExpireRecoveryLinks,
  logSuspiciousActivity,
  SESSION_IDLE_TIMEOUT_MS,
} from './utils/security';
import Login from './components/Login';
import Sidebar from './components/Sidebar';
import Navbar from './components/Navbar';
import Dashboard from './components/Dashboard';
import CargaArchivos from './components/CargaArchivos';
import TablaUnificada from './components/TablaUnificada';
import HistorialCargas from './components/HistorialCargas';
import ConfiguracionEmpresas from './components/ConfiguracionEmpresas';
import ConfiguracionUsuarios from './components/ConfiguracionUsuarios';
import Hub from './components/Hub';
import 'bootstrap/dist/css/bootstrap.min.css';

export default function App() {
  const queryClient = useQueryClient();
  const [session, setSession] = useState(null);
  const [securityBanner, setSecurityBanner] = useState('');

  const [activeCompany, setActiveCompany] = useState(() => {
    const saved = sessionStorage.getItem('activeCompany');
    try {
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [activeTab, setActiveTab] = useState(() => {
    return sessionStorage.getItem('activeTab') || 'dashboard';
  });

  const [activeModule, setActiveModule] = useState(() => {
    return sessionStorage.getItem('activeModule') || null;
  }); // null = Hub, 'ventas' = Ventas, 'compras' = Compras, 'configuracion' = Configuración

  const [sidebarOpen, setSidebarOpen] = useState(false);

  // 1. Inicializar defensas de seguridad (HTTPS, CSRF token, expiración de enlaces de recuperación)
  useEffect(() => {
    enforceHttps();
    getOrCreateCsrfToken();
    const rec = checkAndExpireRecoveryLinks();
    if (rec.expired && rec.message) {
      setSecurityBanner(rec.message);
    }
  }, []);

  // Guardar estado de navegación en sessionStorage (no en localStorage persistente)
  useEffect(() => {
    if (activeModule === null) {
      sessionStorage.removeItem('activeModule');
    } else {
      sessionStorage.setItem('activeModule', activeModule);
    }
  }, [activeModule]);

  useEffect(() => {
    sessionStorage.setItem('activeTab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (activeCompany) {
      sessionStorage.setItem('activeCompany', JSON.stringify(activeCompany));
    } else {
      sessionStorage.removeItem('activeCompany');
    }
  }, [activeCompany]);

  // Limpiar almacenamiento si cambia el usuario de la sesión para evitar fugas de estado
  useEffect(() => {
    if (session?.user?.id) {
      const savedUserId = sessionStorage.getItem('userId');
      if (savedUserId !== session.user.id) {
        sessionStorage.removeItem('activeModule');
        sessionStorage.removeItem('activeTab');
        sessionStorage.removeItem('activeCompany');
        localStorage.removeItem('activeModule');
        localStorage.removeItem('activeTab');
        localStorage.removeItem('activeCompany');
        localStorage.removeItem('userId');
        sessionStorage.setItem('userId', session.user.id);
        setActiveModule(null);
        setActiveTab('dashboard');
        setActiveCompany(null);
      }
    }
  }, [session?.user?.id]);

  // 1. Query del perfil de usuario
  const { data: userProfile, isLoading: profileLoading } = useQuery({
    queryKey: ['userProfile', session?.user?.id],
    queryFn: async () => {
      // Verificar criptográficamente el JWT con el servidor de Auth
      const { data: userCheck, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userCheck?.user) {
        await supabase.auth.signOut();
        throw new Error('Sesión inválida o expirada.');
      }

      const { data, error } = await supabase
        .from('usuarios')
        .select('*, empresas!usuarios_empresa_id_fkey(*)')
        .eq('id', userCheck.user.id)
        .single();
      if (error) throw error;

      // Bloquear inmediatamente si el usuario fue desactivado
      if (!data.activo) {
        await supabase.auth.signOut();
        throw new Error('Tu cuenta de colaborador se encuentra desactivada.');
      }
      return data;
    },
    enabled: !!session?.user?.id,
  });

  const isAdmin = userProfile?.rol === 'admin';
  const canUpload = userProfile?.rol === 'admin' || userProfile?.rol === 'operador';

  // Blindaje de rutas en tiempo real: si un no-admin intenta forzar módulo o pestañas de administración
  useEffect(() => {
    if (!userProfile) return;
    if (!isAdmin && (activeModule === 'configuracion' || activeTab === 'companies' || activeTab === 'users')) {
      logSuspiciousActivity('ACCESO_RUTA_ADMIN_BLOQUEADO', {
        rol: userProfile.rol,
        modulo: activeModule,
        tab: activeTab,
      });
      setActiveModule(null);
      setActiveTab('dashboard');
    }
    if (!canUpload && activeTab === 'upload') {
      logSuspiciousActivity('ACCESO_RUTA_CARGA_BLOQUEADO', {
        rol: userProfile.rol,
        tab: activeTab,
      });
      setActiveTab('dashboard');
    }
  }, [userProfile, isAdmin, canUpload, activeModule, activeTab]);

  // Cierre automático de sesión por inactividad (30 minutos)
  const handleLogout = useCallback(async () => {
    sessionStorage.removeItem('activeModule');
    sessionStorage.removeItem('activeTab');
    sessionStorage.removeItem('activeCompany');
    sessionStorage.removeItem('userId');
    sessionStorage.removeItem('ct_csrf_token');
    queryClient.clear();
    await supabase.auth.signOut();
  }, [queryClient]);

  useEffect(() => {
    if (!session?.user?.id) return undefined;
    let idleTimer;
    const resetTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        setSecurityBanner('Tu sesión se cerró automáticamente por inactividad (30 minutos).');
        handleLogout();
      }, SESSION_IDLE_TIMEOUT_MS);
    };
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));
    resetTimer();
    return () => {
      clearTimeout(idleTimer);
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [session?.user?.id, handleLogout]);

  const changeTab = (tabId) => {
    if ((tabId === 'companies' || tabId === 'users') && !isAdmin) {
      logSuspiciousActivity('INTENTO_TAB_ADMIN_NO_AUTORIZADO', { tabId });
      return;
    }
    if (tabId === 'upload' && !canUpload) {
      logSuspiciousActivity('INTENTO_TAB_UPLOAD_NO_AUTORIZADO', { tabId });
      return;
    }
    setActiveTab(tabId);
    setSidebarOpen(false);
  };

  const handleModuleChange = (newModule) => {
    if (newModule === 'configuracion' && !isAdmin) {
      logSuspiciousActivity('INTENTO_MODULO_CONFIG_NO_AUTORIZADO', { newModule });
      return;
    }
    setActiveModule(newModule);
    setPeriodId(null);
    setActivePeriod('');
    if (newModule === 'configuracion') {
      setActiveTab('companies');
    } else {
      setActiveTab('dashboard');
    }
  };

  // 2. Query de empresas (todas para administradores, o las asignadas para operadores/consulta)
  const { data: companies = [] } = useQuery({
    queryKey: ['companies', userProfile?.id, userProfile?.rol],
    queryFn: async () => {
      if (userProfile.rol === 'admin') {
        const { data, error } = await supabase
          .from('empresas')
          .select('*')
          .order('razon_social', { ascending: true });
        if (error) throw error;
        return data || [];
      } else {
        const { data, error } = await supabase
          .from('usuario_empresas')
          .select('empresas(*)')
          .eq('usuario_id', userProfile.id);
        if (error) throw error;
        return data?.map((d) => d.empresas).filter(Boolean) || [];
      }
    },
    enabled: !!userProfile,
  });

  // 3. Query de periodos de la empresa activa y módulo activo
  const { data: periods = [], refetch: refetchPeriods } = useQuery({
    queryKey: ['periods', activeCompany?.id, activeModule],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('periodos_carga')
        .select('*')
        .eq('empresa_id', activeCompany.id)
        .eq('modulo', activeModule)
        .eq('estado', 'completado')
        .order('fecha_carga', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!activeCompany?.id && (activeModule === 'ventas' || activeModule === 'compras'),
  });

  // Sincronizar activeCompany inicial y verificar que pertenezca a las empresas permitidas del usuario
  useEffect(() => {
    if (companies.length > 0) {
      if (!activeCompany || !companies.some((c) => c.id === activeCompany.id)) {
        setActiveCompany(companies[0]);
      }
    } else if (userProfile?.empresas && !activeCompany) {
      setActiveCompany(userProfile.empresas);
    }
  }, [userProfile, companies, activeCompany]);

  const handleCompanyChange = (companyId) => {
    const selected = companies.find((c) => c.id === companyId);
    if (selected) {
      setActiveCompany(selected);
      setPeriodId(null);
      setActivePeriod('');
    }
  };

  const handlePeriodChange = (selectedPeriodId) => {
    const p = periods.find((per) => per.id === selectedPeriodId);
    if (p) {
      setPeriodId(p.id);
      let label = p.periodo;
      if (p.dia) {
        label += ` (Día: ${p.dia}, v${p.version || 1})`;
      }
      setActivePeriod(label);
    }
  };

  // Filtro inicial para la tabla de conciliación
  const [reconciliationFilter, setReconciliationFilter] = useState(null);

  const navigateToReconciliation = (filterType) => {
    setReconciliationFilter(filterType);
    changeTab('reconciliation');
  };

  // Período activo actualmente seleccionado
  const [periodId, setPeriodId] = useState(null);
  const [activePeriod, setActivePeriod] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (!newSession) {
        setActiveCompany(null);
        setPeriodId(null);
        setActivePeriod('');
        sessionStorage.removeItem('activeModule');
        sessionStorage.removeItem('activeTab');
        sessionStorage.removeItem('activeCompany');
        sessionStorage.removeItem('userId');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Cargar automáticamente el último período al cambiar activeCompany o activeModule
  useEffect(() => {
    if (activeCompany?.id && (activeModule === 'ventas' || activeModule === 'compras')) {
      const loadLastPeriod = async () => {
        try {
          const { data, error } = await supabase
            .from('periodos_carga')
            .select('*')
            .eq('empresa_id', activeCompany.id)
            .eq('modulo', activeModule)
            .eq('estado', 'completado')
            .order('fecha_carga', { ascending: false })
            .limit(1);

          if (error) throw error;

          if (data && data.length > 0) {
            setPeriodId(data[0].id);
            let label = data[0].periodo;
            if (data[0].dia) {
              label += ` (Día: ${data[0].dia}, v${data[0].version || 1})`;
            }
            setActivePeriod(label);
          } else {
            setPeriodId(null);
            setActivePeriod('');
          }
        } catch {
          setPeriodId(null);
          setActivePeriod('');
        }
      };
      loadLastPeriod();
    } else {
      setPeriodId(null);
      setActivePeriod('');
    }
  }, [activeCompany?.id, activeModule]);

  const handleLoginSuccess = (user) => {
    setSecurityBanner('');
    getOrCreateCsrfToken();
    setSession({ user });
  };

  const handleProcessComplete = (newPeriodId, newPeriod) => {
    setPeriodId(newPeriodId);
    setActivePeriod(newPeriod);
    refetchPeriods();
    changeTab('reconciliation');
  };

  const handleSelectPeriod = (histPeriodId, histPeriod, histDia, histVersion) => {
    setPeriodId(histPeriodId);
    let label = histPeriod;
    if (histDia) {
      label += ` (Día: ${histDia}, v${histVersion || 1})`;
    }
    setActivePeriod(label);
    changeTab('dashboard');
  };

  const handleDeletePeriod = (deletedPeriodId) => {
    refetchPeriods();
    if (periodId === deletedPeriodId) {
      setPeriodId(null);
      setActivePeriod('');
    }
  };

  if (session && profileLoading) {
    return (
      <div
        className="d-flex align-items-center justify-content-center min-vh-100"
        style={{ backgroundColor: 'var(--bg-primary)' }}
      >
        <div className="spinner-border text-primary" role="status"></div>
      </div>
    );
  }

  if (!session || !userProfile) {
    return <Login onLoginSuccess={handleLoginSuccess} initialBanner={securityBanner} />;
  }

  if (!activeModule) {
    return (
      <Hub
        userProfile={userProfile}
        activeCompany={activeCompany}
        companies={companies}
        onChangeCompany={handleCompanyChange}
        onLogout={handleLogout}
        onSelectModule={handleModuleChange}
      />
    );
  }

  return (
    <div className="app-container">
      {sidebarOpen && (
        <div
          className="sidebar-backdrop d-lg-none"
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            zIndex: 1050,
            backdropFilter: 'blur(4px)',
            cursor: 'pointer',
          }}
        />
      )}

      <Sidebar
        activeTab={activeTab}
        setActiveTab={changeTab}
        userProfile={userProfile}
        onLogout={handleLogout}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        activeModule={activeModule}
        onReturnToHub={() => handleModuleChange(null)}
      />

      <main className="main-content">
        <Navbar
          activeCompany={activeCompany}
          activePeriod={activePeriod}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          companies={companies}
          onChangeCompany={handleCompanyChange}
          userRole={userProfile?.rol}
          periods={periods}
          periodId={periodId}
          onChangePeriod={handlePeriodChange}
          activeModule={activeModule}
        />

        {activeTab === 'dashboard' && (
          <Dashboard
            activeCompany={activeCompany}
            periodId={periodId}
            activePeriod={activePeriod}
            onNavigateToReconciliation={navigateToReconciliation}
            activeModule={activeModule}
          />
        )}

        {activeTab === 'upload' && canUpload && (
          <CargaArchivos
            activeCompany={activeCompany}
            userProfile={userProfile}
            onProcessComplete={handleProcessComplete}
            activeModule={activeModule}
          />
        )}

        {activeTab === 'reconciliation' && (
          <TablaUnificada
            periodId={periodId}
            activePeriod={activePeriod}
            initialFilter={reconciliationFilter}
            onFilterReset={() => setReconciliationFilter(null)}
            activeModule={activeModule}
            activeCompany={activeCompany}
            userProfile={userProfile}
            onProcessComplete={handleProcessComplete}
          />
        )}

        {activeTab === 'history' && (
          <HistorialCargas
            activeCompany={activeCompany}
            onSelectPeriod={handleSelectPeriod}
            onDeletePeriod={handleDeletePeriod}
            activeModule={activeModule}
            userProfile={userProfile}
          />
        )}

        {activeTab === 'companies' && isAdmin && (
          <ConfiguracionEmpresas
            activeCompany={activeCompany}
            activeModule={activeModule}
            userProfile={userProfile}
          />
        )}

        {activeTab === 'users' && isAdmin && (
          <ConfiguracionUsuarios
            activeCompany={activeCompany}
            userProfile={userProfile}
          />
        )}
      </main>
    </div>
  );
}
