import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './utils/supabaseClient';
import {
  enforceHttps,
  getOrCreateCsrfToken,
  checkAndExpireRecoveryLinks,
  logSuspiciousActivity,
  SESSION_IDLE_TIMEOUT_MS,
} from './utils/security';
import { useNetworkProfile } from './utils/networkProfile';
import { clearPersistedQueryCache } from './utils/queryPersister';
import Sidebar from './components/Sidebar';
import Navbar from './components/Navbar';
import { SkeletonAppShell, SkeletonDashboard, SkeletonTable } from './components/SkeletonLoader';
import 'bootstrap/dist/css/bootstrap.min.css';

// División de JavaScript por página / módulo (Route-based Code Splitting)
const Login = lazy(() => import('./components/Login'));
const Hub = lazy(() => import('./components/Hub'));
const Dashboard = lazy(() => import('./components/Dashboard'));
const CargaArchivos = lazy(() => import('./components/CargaArchivos'));
const TablaUnificada = lazy(() => import('./components/TablaUnificada'));
const HistorialCargas = lazy(() => import('./components/HistorialCargas'));
const ConfiguracionEmpresas = lazy(() => import('./components/ConfiguracionEmpresas'));
const ConfiguracionUsuarios = lazy(() => import('./components/ConfiguracionUsuarios'));

// Columnas estrictamente necesarias por consulta (evita SELECT *)
const COLS_USUARIO_PERFIL =
  'id, nombre, rol, activo, empresa_id, estudio_id, empresas!usuarios_empresa_id_fkey(id, ruc, razon_social, activo, estudio_id)';
const COLS_EMPRESA = 'id, ruc, razon_social, activo, estudio_id';
const COLS_PERIODO = 'id, empresa_id, periodo, dia, version, fecha_carga, estado, modulo';

export default function App() {
  const queryClient = useQueryClient();
  const networkProfile = useNetworkProfile();

  // Restaurar sesión síncronamente desde sessionStorage en el frame 0 para no bloquear con cascada al dar F5
  const [session, setSession] = useState(() => {
    try {
      const raw = sessionStorage.getItem('ct-auth-session');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.user ? parsed : null;
    } catch {
      return null;
    }
  });
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
  });

  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Persistir y restaurar período activo desde sessionStorage para carga instantánea en F5
  const [periodId, setPeriodId] = useState(() => {
    return sessionStorage.getItem('activePeriodId') || null;
  });
  const [activePeriod, setActivePeriod] = useState(() => {
    return sessionStorage.getItem('activePeriodLabel') || '';
  });

  // Filtro inicial para la tabla de conciliación
  const [reconciliationFilter, setReconciliationFilter] = useState(null);

  // 1. Inicializar defensas de seguridad (HTTPS, CSRF token, expiración de enlaces de recuperación)
  useEffect(() => {
    enforceHttps();
    getOrCreateCsrfToken();
    const rec = checkAndExpireRecoveryLinks();
    if (rec.expired && rec.message) {
      setSecurityBanner(rec.message);
    }
  }, []);

  // Guardar estado de navegación en sessionStorage
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

  useEffect(() => {
    if (periodId) {
      sessionStorage.setItem('activePeriodId', periodId);
    } else {
      sessionStorage.removeItem('activePeriodId');
    }
  }, [periodId]);

  useEffect(() => {
    if (activePeriod) {
      sessionStorage.setItem('activePeriodLabel', activePeriod);
    } else {
      sessionStorage.removeItem('activePeriodLabel');
    }
  }, [activePeriod]);

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

  // 1. Query del perfil de usuario (pide solo columnas requeridas)
  const { data: userProfile, isLoading: profileLoading } = useQuery({
    queryKey: ['userProfile', session?.user?.id],
    queryFn: async () => {
      const { data: userCheck, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userCheck?.user) {
        await supabase.auth.signOut();
        throw new Error('Sesión inválida o expirada.');
      }

      const { data, error } = await supabase
        .from('usuarios')
        .select(COLS_USUARIO_PERFIL)
        .eq('id', userCheck.user.id)
        .single();
      if (error) throw error;

      if (!data.activo) {
        await supabase.auth.signOut();
        throw new Error('Tu cuenta de colaborador se encuentra desactivada.');
      }
      return data;
    },
    enabled: !!session?.user?.id,
    staleTime: 10 * 60 * 1000,
  });

  const isAdmin = userProfile?.rol === 'admin';
  const canUpload = userProfile?.rol === 'admin' || userProfile?.rol === 'operador';

  // Blindaje de rutas en tiempo real
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
    sessionStorage.removeItem('activePeriodId');
    sessionStorage.removeItem('activePeriodLabel');
    sessionStorage.removeItem('userId');
    sessionStorage.removeItem('ct_csrf_token');
    queryClient.clear();
    await clearPersistedQueryCache();
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

  const changeTab = useCallback(
    (tabId) => {
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
    },
    [isAdmin, canUpload]
  );

  const handleModuleChange = useCallback(
    (newModule) => {
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
    },
    [isAdmin]
  );

  // 2. Query de empresas (pide solo columnas requeridas y se comparte en caché)
  const { data: companies = [] } = useQuery({
    queryKey: ['companies', userProfile?.id, userProfile?.rol],
    queryFn: async () => {
      if (userProfile.rol === 'admin') {
        const { data, error } = await supabase
          .from('empresas')
          .select(COLS_EMPRESA)
          .order('razon_social', { ascending: true });
        if (error) throw error;
        return data || [];
      } else {
        const { data, error } = await supabase
          .from('usuario_empresas')
          .select(`empresas(${COLS_EMPRESA})`)
          .eq('usuario_id', userProfile.id);
        if (error) throw error;
        return data?.map((d) => d.empresas).filter(Boolean) || [];
      }
    },
    enabled: !!userProfile,
    staleTime: 5 * 60 * 1000,
  });

  // 3. Query única de periodos (evita la llamada duplicada de loadLastPeriod)
  const { data: periods = [], isFetched: periodsFetched, refetch: refetchPeriods } = useQuery({
    queryKey: ['periods', activeCompany?.id, activeModule],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('periodos_carga')
        .select(COLS_PERIODO)
        .eq('empresa_id', activeCompany.id)
        .eq('modulo', activeModule)
        .eq('estado', 'completado')
        .order('fecha_carga', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeCompany?.id && (activeModule === 'ventas' || activeModule === 'compras'),
    staleTime: 30 * 60 * 1000,
  });

  // Sincronizar activeCompany inicial
  useEffect(() => {
    if (companies.length > 0) {
      if (!activeCompany || !companies.some((c) => c.id === activeCompany.id)) {
        setActiveCompany(companies[0]);
      }
    } else if (userProfile?.empresas && !activeCompany) {
      setActiveCompany(userProfile.empresas);
    }
  }, [userProfile, companies, activeCompany]);

  // Seleccionar automáticamente el último período a partir de `periods` sin borrar el `periodId` restaurado mientras carga
  useEffect(() => {
    if (!activeCompany?.id || (activeModule !== 'ventas' && activeModule !== 'compras')) {
      setPeriodId(null);
      setActivePeriod('');
      return;
    }
    if (periods.length > 0) {
      const currentExists = periodId && periods.some((p) => p.id === periodId);
      if (!currentExists) {
        const latest = periods[0];
        setPeriodId(latest.id);
        let label = latest.periodo;
        if (latest.dia) {
          label += ` (Día: ${latest.dia}, v${latest.version || 1})`;
        }
        setActivePeriod(label);
      }
    } else if (periodsFetched) {
      setPeriodId(null);
      setActivePeriod('');
    }
  }, [activeCompany?.id, activeModule, periods, periodsFetched, periodId]);

  const handleCompanyChange = useCallback(
    (companyId) => {
      const selected = companies.find((c) => c.id === companyId);
      if (selected) {
        setActiveCompany(selected);
        setPeriodId(null);
        setActivePeriod('');
      }
    },
    [companies]
  );

  const handlePeriodChange = useCallback(
    (selectedPeriodId) => {
      const p = periods.find((per) => per.id === selectedPeriodId);
      if (p) {
        setPeriodId(p.id);
        let label = p.periodo;
        if (p.dia) {
          label += ` (Día: ${p.dia}, v${p.version || 1})`;
        }
        setActivePeriod(label);
      }
    },
    [periods]
  );

  const navigateToReconciliation = useCallback(
    (filterType) => {
      setReconciliationFilter(filterType);
      changeTab('reconciliation');
    },
    [changeTab]
  );

  const resetReconciliationFilter = useCallback(() => {
    setReconciliationFilter(null);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const returnToHub = useCallback(() => {
    handleModuleChange(null);
  }, [handleModuleChange]);

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

  // Pre-poblar caché del perfil al iniciar sesión para evitar consulta duplicada
  const handleLoginSuccess = useCallback(
    (user, profile) => {
      setSecurityBanner('');
      getOrCreateCsrfToken();
      if (user?.id && profile) {
        queryClient.setQueryData(['userProfile', user.id], profile);
      }
      setSession({ user });
    },
    [queryClient]
  );

  const handleProcessComplete = useCallback(
    (newPeriodId, newPeriod) => {
      setPeriodId(newPeriodId);
      setActivePeriod(newPeriod);
      refetchPeriods();
      changeTab('reconciliation');
    },
    [refetchPeriods, changeTab]
  );

  const handleSelectPeriod = useCallback(
    (histPeriodId, histPeriod, histDia, histVersion) => {
      setPeriodId(histPeriodId);
      let label = histPeriod;
      if (histDia) {
        label += ` (Día: ${histDia}, v${histVersion || 1})`;
      }
      setActivePeriod(label);
      changeTab('dashboard');
    },
    [changeTab]
  );

  const handleDeletePeriod = useCallback(
    (deletedPeriodId) => {
      refetchPeriods();
      if (deletedPeriodId === null || periodId === deletedPeriodId) {
        setPeriodId(null);
        setActivePeriod('');
      }
    },
    [refetchPeriods, periodId]
  );

  if (session && profileLoading) {
    return <SkeletonAppShell />;
  }

  if (!session || !userProfile) {
    return (
      <Suspense fallback={<SkeletonAppShell />}>
        <Login onLoginSuccess={handleLoginSuccess} initialBanner={securityBanner} />
      </Suspense>
    );
  }

  if (!activeModule) {
    return (
      <Suspense fallback={<SkeletonAppShell />}>
        <Hub
          userProfile={userProfile}
          activeCompany={activeCompany}
          companies={companies}
          onChangeCompany={handleCompanyChange}
          onLogout={handleLogout}
          onSelectModule={handleModuleChange}
        />
      </Suspense>
    );
  }

  return (
    <div className={`app-container ${networkProfile.isSlowNetwork ? 'slow-network-mode' : ''}`}>
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
        onReturnToHub={returnToHub}
      />

      <main className="main-content">
        <Navbar
          activeCompany={activeCompany}
          activePeriod={activePeriod}
          onToggleSidebar={toggleSidebar}
          companies={companies}
          onChangeCompany={handleCompanyChange}
          userRole={userProfile?.rol}
          periods={periods}
          periodId={periodId}
          onChangePeriod={handlePeriodChange}
          activeModule={activeModule}
        />

        <Suspense
          fallback={
            activeTab === 'dashboard' ? (
              <SkeletonDashboard kpiCount={activeModule === 'compras' ? 4 : 10} />
            ) : (
              <div className="card-premium p-4">
                <SkeletonTable rows={10} columns={8} />
              </div>
            )
          }
        >
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
              periods={periods}
            />
          )}

          {activeTab === 'reconciliation' && (
            <TablaUnificada
              periodId={periodId}
              activePeriod={activePeriod}
              initialFilter={reconciliationFilter}
              onFilterReset={resetReconciliationFilter}
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
        </Suspense>
      </main>
    </div>
  );
}
