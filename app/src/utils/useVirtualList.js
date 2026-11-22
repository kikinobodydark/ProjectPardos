// ============================================================================
// Hook de Virtualización de Listas y Tablas Largas (Windowing / Virtual Scroll)
// Renderiza únicamente las filas visibles en el viewport + un margen (overscan),
// insertando espaciadores superior e inferior para mantener el scroll nativo.
// ============================================================================
import { useState, useMemo, useCallback, useRef } from 'react';

export function calculateVirtualRange({
  totalCount,
  scrollTop = 0,
  viewportHeight = 560,
  rowHeight = 36,
  overscan = 8,
  enabled = true,
}) {
  if (!enabled || totalCount <= 40) {
    return {
      isVirtualized: false,
      startIndex: 0,
      endIndex: totalCount,
      topPaddingHeight: 0,
      bottomPaddingHeight: 0,
    };
  }

  const rawStart = Math.floor(scrollTop / rowHeight);
  const visibleCount = Math.ceil(viewportHeight / rowHeight);
  const startIndex = Math.max(0, rawStart - overscan);
  const endIndex = Math.min(totalCount, rawStart + visibleCount + overscan);

  const topPaddingHeight = startIndex * rowHeight;
  const bottomPaddingHeight = Math.max(0, (totalCount - endIndex) * rowHeight);

  return {
    isVirtualized: true,
    startIndex,
    endIndex,
    topPaddingHeight,
    bottomPaddingHeight,
  };
}

export function useVirtualList(items = [], { rowHeight = 36, viewportHeight = 560, overscan = 8, threshold = 40 } = {}) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef(null);

  const onScroll = useCallback((e) => {
    const nextTop = e.currentTarget.scrollTop;
    setScrollTop(nextTop);
  }, []);

  const enabled = items.length > threshold;

  const range = useMemo(
    () =>
      calculateVirtualRange({
        totalCount: items.length,
        scrollTop,
        viewportHeight,
        rowHeight,
        overscan,
        enabled,
      }),
    [items.length, scrollTop, viewportHeight, rowHeight, overscan, enabled]
  );

  const visibleItems = useMemo(
    () => (range.isVirtualized ? items.slice(range.startIndex, range.endIndex) : items),
    [items, range.isVirtualized, range.startIndex, range.endIndex]
  );

  return {
    containerRef,
    onScroll,
    visibleItems,
    isVirtualized: range.isVirtualized,
    startIndex: range.startIndex,
    endIndex: range.endIndex,
    topPaddingHeight: range.topPaddingHeight,
    bottomPaddingHeight: range.bottomPaddingHeight,
    maxHeight: enabled ? `${viewportHeight}px` : undefined,
  };
}
