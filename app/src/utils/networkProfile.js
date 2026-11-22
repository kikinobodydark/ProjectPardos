// ============================================================================
// Detección y Adaptación para Móviles y Redes Lentas (2G / 3G / Save-Data)
// - Detecta `navigator.connection` (Network Information API) y viewport móvil
// - Ajusta automáticamente tamaño de página, tamaño de lotes (chunks) y
//   concurrencia del pool para mantener la app fluida en redes con alta latencia
// - Permite simular perfiles de red lenta y móvil para pruebas automatizadas
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
      recommendedBatchSize: simulatedOverride.isSlowNetwork ? 400 : 1000,
      recommendedConcurrency: simulatedOverride.isSlowNetwork ? 2 : 4,
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

  const isSlowNetwork =
    saveData ||
    effectiveType === 'slow-2g' ||
    effectiveType === '2g' ||
    effectiveType === '3g' ||
    (rtt > 400 && rtt < 10000) ||
    (downlink > 0 && downlink < 1.5);

  const isMobile = isBrowser ? window.innerWidth <= 768 : false;

  // Ajustar umbral de alerta de OpenTelemetry según calidad de red
  setSlowRequestThreshold(isSlowNetwork ? 1200 : 500);

  return {
    isMobile,
    isSlowNetwork,
    saveData,
    effectiveType,
    rtt,
    downlink,
    recommendedPageSize: isSlowNetwork || isMobile ? 15 : 20,
    recommendedBatchSize: isSlowNetwork ? 400 : 1000,
    recommendedConcurrency: isSlowNetwork ? 2 : 4,
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
