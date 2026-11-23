// ============================================================================
// Detección y Adaptación para Móviles y Redes Lentas (2G / Save-Data)
// - En conexiones normales mantiene lotes medianos (500) y concurrencia
//   controlada (2) para avance fluido de la barra de progreso y evitar
//   statement_timeout en Supabase Postgres con tablas de miles de registros.
// - En redes genuinamente restringidas (2G / Save-Data) reduce a lotes de 250
//   con 1 stream secuencial.
// ============================================================================
import { useState, useEffect } from 'react';
import { setSlowRequestThreshold } from './telemetry.js';

let simulatedOverride = null;

export function simulateNetworkProfile(override = null) {
  simulatedOverride = override;
  if (override?.slowThresholdMs) {
    setSlowRequestThreshold(override.slowThresholdMs);
  }
}

export function getNetworkProfile() {
  if (simulatedOverride) {
    return {
      isMobile: !!simulatedOverride.isMobile,
      isSlowNetwork: !!simulatedOverride.isSlowNetwork,
      saveData: !!simulatedOverride.saveData,
      effectiveType: simulatedOverride.effectiveType || '4g',
      rtt: simulatedOverride.rtt ?? 50,
      downlink: simulatedOverride.downlink ?? 10,
      recommendedPageSize: simulatedOverride.isSlowNetwork || simulatedOverride.isMobile ? 15 : 20,
      recommendedBatchSize: simulatedOverride.isSlowNetwork ? 250 : 500,
      recommendedConcurrency: simulatedOverride.isSlowNetwork ? 1 : 2,
      recommendedBulkUploadBatchSize: simulatedOverride.isSlowNetwork ? 500 : 2000,
      recommendedBulkUploadConcurrency: simulatedOverride.isSlowNetwork ? 1 : 4,
      recommendedReadPageSize: simulatedOverride.isSlowNetwork ? 500 : 1000,
      recommendedReadRpcLimit: simulatedOverride.isSlowNetwork ? 1500 : 2500,
      recommendedReadConcurrency: simulatedOverride.isSlowNetwork ? 1 : 2,
    };
  }

  const isBrowser = typeof window !== 'undefined';
  const conn = isBrowser
    ? navigator.connection || navigator.mozConnection || navigator.webkitConnection
    : null;

  const effectiveType = conn?.effectiveType || '4g';
  const saveData = !!conn?.saveData;
  const rtt = typeof conn?.rtt === 'number' ? conn.rtt : 50;
  const downlink = typeof conn?.downlink === 'number' ? conn.downlink : 10;

  // Solo activar modo restringido en 2G / slow-2g o cuando el usuario activa Save-Data explícitamente
  const isSlowNetwork =
    saveData ||
    effectiveType === 'slow-2g' ||
    effectiveType === '2g';

  const isMobile = isBrowser ? window.innerWidth <= 768 : false;

  setSlowRequestThreshold(isSlowNetwork ? 1200 : 500);

  return {
    isMobile,
    isSlowNetwork,
    saveData,
    effectiveType,
    rtt,
    downlink,
    recommendedPageSize: isSlowNetwork || isMobile ? 15 : 20,
    recommendedBatchSize: isSlowNetwork ? 250 : 500,
    recommendedConcurrency: isSlowNetwork ? 1 : 2,
    recommendedBulkUploadBatchSize: isSlowNetwork ? 500 : 2000,
    recommendedBulkUploadConcurrency: isSlowNetwork ? 1 : 4,
    recommendedReadPageSize: isSlowNetwork ? 500 : 1000,
    recommendedReadRpcLimit: isSlowNetwork ? 1500 : 2500,
    recommendedReadConcurrency: isSlowNetwork ? 1 : 2,
  };
}

export function useNetworkProfile() {
  const [profile, setProfile] = useState(() => getNetworkProfile());

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const update = () => setProfile(getNetworkProfile());
    window.addEventListener('resize', update, { passive: true });

    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn && conn.addEventListener) {
      conn.addEventListener('change', update);
    }

    return () => {
      window.removeEventListener('resize', update);
      if (conn && conn.removeEventListener) {
        conn.removeEventListener('change', update);
      }
    };
  }, []);

  return profile;
}
