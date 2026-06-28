import React, { useState, useEffect } from 'react';
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
  const [userProfile, setUserProfile] = useState(null);
  const [activeCompany, setActiveCompany] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);

  // Período activo actualmente seleccionado
  const [periodId, setPeriodId] = useState(null);
  const [activePeriod, setActivePeriod] = useState('');

  useEffect(() => {
    // 1. Obtener sesión activa de auth
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        fetchUserProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // 2. Escuchar cambios de autenticación
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        fetchUserProfile(session.user.id);
      } else {
        setUserProfile(null);
        setActiveCompany(null);
        setPeriodId(null);
        setActivePeriod('');
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchUserProfile = async (userId) => {
    try {
      const { data, error } = await supabase
        .from('usuarios')
        .select('*, empresas(*)')
        .eq('id', userId)
        .single();

      if (error) throw error;
      
      setUserProfile(data);
      if (data?.empresas) {
        setActiveCompany(data.empresas);
        // Autoseleccionar último período cargado por la empresa
        fetchLastPeriod(data.empresas.id);
      }
    } catch (e) {
      console.error("Error al cargar perfil de usuario:", e);
    } finally {
      setLoading(false);
    }
  };

  const fetchLastPeriod = async (companyId) => {
    try {
      const { data, error } = await supabase
        .from('periodos_carga')
        .select('*')
        .eq('empresa_id', companyId)
        .eq('estado', 'completado')
        .order('fecha_carga', { ascending: false })
        .limit(1);

      if (error) throw error;

      if (data && data.length > 0) {
        setPeriodId(data[0].id);
        setActivePeriod(data[0].periodo);
      }
    } catch (e) {
      console.error("Error obteniendo último período:", e);
    }
  };

  const handleLoginSuccess = (user, profile) => {
    setSession({ user });
    setUserProfile(profile);
    if (profile?.empresas) {
      setActiveCompany(profile.empresas);
      fetchLastPeriod(profile.empresas.id);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleProcessComplete = (newPeriodId, newPeriod) => {
    setPeriodId(newPeriodId);
    setActivePeriod(newPeriod);
    setActiveTab('reconciliation'); // Redirigir a la tabla de conciliación tras cargar
  };

  const handleSelectPeriod = (histPeriodId, histPeriod) => {
    setPeriodId(histPeriodId);
    setActivePeriod(histPeriod);
    setActiveTab('dashboard'); // Ir al dashboard para ver resumen del período seleccionado
  };

  if (loading) {
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
        setActiveTab={setActiveTab} 
        userProfile={userProfile}
        onLogout={handleLogout}
      />

      {/* Área de contenido principal */}
      <main className="main-content">
        <Navbar 
          activeCompany={activeCompany} 
          activePeriod={activePeriod} 
        />

        {activeTab === 'dashboard' && (
          <Dashboard 
            activeCompany={activeCompany} 
            periodId={periodId} 
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
