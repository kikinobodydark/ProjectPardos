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
import 'bootstrap/dist/css/bootstrap.min.css';

export default function App() {
  const [session, setSession] = useState(null);
  const [activeCompany, setActiveCompany] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const changeTab = (tabId) => {
    setActiveTab(tabId);
    setSidebarOpen(false);
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

  // 3. Query de periodos de la empresa activa
  const { data: periods = [], refetch: refetchPeriods } = useQuery({
    queryKey: ['periods', activeCompany?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('periodos_carga')
        .select('*')
        .eq('empresa_id', activeCompany.id)
        .eq('estado', 'completado')
        .order('fecha_carga', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!activeCompany?.id,
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

  // Cargar automáticamente el último período al cambiar activeCompany
  useEffect(() => {
    if (activeCompany?.id) {
      const loadLastPeriod = async () => {
        try {
          const { data, error } = await supabase
            .from('periodos_carga')
            .select('*')
            .eq('empresa_id', activeCompany.id)
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
    }
  }, [activeCompany?.id]);

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

  return (
    <div className="app-container">
      {/* Sidebar fijo */}
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={changeTab} 
        userProfile={userProfile}
        onLogout={handleLogout}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
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
          />
        )}

        {activeTab === 'upload' && (
          <CargaArchivos 
            activeCompany={activeCompany} 
            userProfile={userProfile}
            onProcessComplete={handleProcessComplete}
          />
        )}

        {activeTab === 'reconciliation' && (
          <TablaUnificada 
            periodId={periodId} 
            activePeriod={activePeriod}
            initialFilter={reconciliationFilter}
            onFilterReset={() => setReconciliationFilter(null)}
          />
        )}

        {activeTab === 'history' && (
          <HistorialCargas 
            activeCompany={activeCompany} 
            onSelectPeriod={handleSelectPeriod}
          />
        )}

        {activeTab === 'companies' && (
          <ConfiguracionEmpresas 
            activeCompany={activeCompany} 
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
