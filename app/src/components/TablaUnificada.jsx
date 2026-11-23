import React, { memo, lazy, Suspense } from 'react';
import { SkeletonTable } from './SkeletonLoader';

const ConciliacionVentas = lazy(() => import('./ventas/ConciliacionVentas'));
const ConciliacionCompras = lazy(() => import('./compras/ConciliacionCompras'));

const TablaUnificada = memo(function TablaUnificada({
  periodId,
  activePeriod,
  activePeriodObj = null,
  initialFilter,
  onFilterReset,
  activeModule,
  activeCompany,
  userProfile,
  onProcessComplete,
  selectedLocalId = 'ALL',
  onChangeLocalId,
}) {
  if (activeModule !== 'compras') {
    return (
      <Suspense
        fallback={
          <div className="card-premium p-4">
            <SkeletonTable rows={10} columns={10} title="Cargando módulo de conciliación de ventas..." />
          </div>
        }
      >
        <ConciliacionVentas
          periodId={periodId}
          activePeriod={activePeriod}
          activePeriodObj={activePeriodObj}
          initialFilter={initialFilter}
          onFilterReset={onFilterReset}
          activeCompany={activeCompany}
          userProfile={userProfile}
          onProcessComplete={onProcessComplete}
          selectedLocalId={selectedLocalId}
          onChangeLocalId={onChangeLocalId}
        />
      </Suspense>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="card-premium p-4">
          <SkeletonTable rows={10} columns={10} title="Cargando módulo de conciliación de compras..." />
        </div>
      }
    >
      <ConciliacionCompras
        periodId={periodId}
        activePeriod={activePeriod}
        activePeriodObj={activePeriodObj}
        initialFilter={initialFilter}
        onFilterReset={onFilterReset}
        activeCompany={activeCompany}
        userProfile={userProfile}
      />
    </Suspense>
  );
});

export default TablaUnificada;
