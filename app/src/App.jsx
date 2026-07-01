import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './utils/supabaseClient';
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
  const [session, setSession] = useState(null);
  const [activeCompany, setActiveCompany] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeModule, setActiveModule] = useState(null); // null = Hub, 'ventas' = Ventas, 'compras' = Compras, 'configuracion' = Configuración

  const changeTab = (tabId) => {
    setActiveTab(tabId);
    setSidebarOpen(false);
  };

  const handleModuleChange = (newModule) => {
    setActiveModule(newModule);
    setPeriodId(null);
    setActivePeriod('');
    if (newModule === 'configuracion') {
      setActiveTab('companies');
    } else {
      setActiveTab('dashboard');
    }
  };

  // 1. Query del perfil de usuario
  const { data: userProfile, isLoading: profileLoading } = useQuery({
    queryKey: ['userProfile', session?.user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('usuarios')
        .select('*, empresas(*)')
        .eq('id', session.user.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user?.id,
  });

  // 2. Query de empresas (solo administradores)
  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('empresas')
        .select('*')
        .order('razon_social', { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!userProfile && userProfile.rol === 'admin',
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

  // Sincronizar activeCompany inicial al cargar el perfil
  useEffect(() => {
    if (userProfile?.empresas && !activeCompany) {
      setActiveCompany(userProfile.empresas);
    }
  }, [userProfile, activeCompany]);

  const handleCompanyChange = (companyId) => {
    const selected = companies.find(c => c.id === companyId);
    if (selected) {
      setActiveCompany(selected);
      setPeriodId(null);
      setActivePeriod('');
    }
  };

  const handlePeriodChange = (selectedPeriodId) => {
    const p = periods.find(per => per.id === selectedPeriodId);
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
    // 1. Obtener sesión activa de auth
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    // 2. Escuchar cambios de autenticación
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!session) {
        setActiveCompany(null);
        setPeriodId(null);
        setActivePeriod('');
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
        } catch (e) {
          console.error("Error obteniendo último período:", e);
        }
      };
      loadLastPeriod();
    } else {
      setPeriodId(null);
      setActivePeriod('');
    }
  }, [activeCompany?.id, activeModule]);

  const handleLoginSuccess = (user) => {
    setSession({ user });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
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
    return <Login onLoginSuccess={handleLoginSuccess} />;
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
      {/* Backdrop para celular cuando el sidebar está abierto */}
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
            cursor: 'pointer'
          }}
        />
      )}

      {/* Sidebar fijo */}
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

      {/* Área de contenido principal */}
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
        />

        {activeTab === 'dashboard' && (
          <Dashboard 
            activeCompany={activeCompany} 
            periodId={periodId} 
            onNavigateToReconciliation={navigateToReconciliation}
            activeModule={activeModule}
          />
        )}

        {activeTab === 'upload' && (
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
          />
        )}

        {activeTab === 'history' && (
          <HistorialCargas 
            activeCompany={activeCompany} 
            onSelectPeriod={handleSelectPeriod}
            onDeletePeriod={handleDeletePeriod}
            activeModule={activeModule}
          />
        )}

        {activeTab === 'companies' && (
          <ConfiguracionEmpresas 
            activeCompany={activeCompany} 
            activeModule={activeModule}
          />
        )}

        {activeTab === 'users' && (
          <ConfiguracionUsuarios 
            activeCompany={activeCompany} 
            userProfile={userProfile}
          />
        )}
      </main>
    </div>
  );
}
