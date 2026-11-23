// ============================================================================
// Selector de Local (UI/UX Pro Max — Data-Dense Financial Dashboard)
// - Reemplaza el <select> nativo por un menú desplegable estilizado, accesible
//   por teclado (ArrowUp/ArrowDown/Enter/Escape), con búsqueda rápida y chips
//   de series codificados por color (Factura, Boleta, Notas).
// ============================================================================
import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import { FiMapPin, FiChevronDown, FiCheck, FiSearch, FiX, FiLayers, FiAlertCircle } from 'react-icons/fi';

const SelectorLocal = memo(function SelectorLocal({
  locales = [],
  value = 'ALL',
  onChange,
  mostrarSinAsignar = true,
  align = 'left', // 'left' | 'right'
}) {
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [indiceFoco, setIndiceFoco] = useState(-1);
  const containerRef = useRef(null);
  const searchInputRef = useRef(null);

  const localActivo = useMemo(
    () => locales.find((l) => l.id === value) || null,
    [locales, value]
  );

  const localesFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return locales;
    return locales.filter(
      (loc) =>
        loc.nombre.toLowerCase().includes(q) ||
        (loc.resumenSeries || '').toLowerCase().includes(q)
    );
  }, [locales, busqueda]);

  // Lista plana de opciones para navegación por teclado
  const opciones = useMemo(() => {
    const list = [{ id: 'ALL', tipo: 'all', label: 'Todos los locales' }];
    for (const loc of localesFiltrados) {
      list.push({ id: loc.id, tipo: 'local', local: loc });
    }
    if (mostrarSinAsignar && !busqueda.trim()) {
      list.push({ id: 'SIN_LOCAL', tipo: 'sin_local', label: 'Sin local asignado' });
    }
    return list;
  }, [localesFiltrados, mostrarSinAsignar, busqueda]);

  useEffect(() => {
    if (!abierto) return undefined;
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setAbierto(false);
        setBusqueda('');
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setAbierto(false);
        setBusqueda('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [abierto]);

  useEffect(() => {
    if (abierto && locales.length > 5 && searchInputRef.current) {
      searchInputRef.current.focus();
    }
    if (abierto) {
      const currentIdx = opciones.findIndex((o) => o.id === value);
      setIndiceFoco(currentIdx >= 0 ? currentIdx : 0);
    }
  }, [abierto, locales.length, opciones, value]);

  if (!locales || locales.length === 0) return null;

  const seleccionar = (id) => {
    if (onChange) onChange(id);
    setAbierto(false);
    setBusqueda('');
  };

  const handleMenuKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndiceFoco((prev) => (prev + 1) % opciones.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndiceFoco((prev) => (prev <= 0 ? opciones.length - 1 : prev - 1));
    } else if (e.key === 'Enter' && indiceFoco >= 0 && opciones[indiceFoco]) {
      e.preventDefault();
      seleccionar(opciones[indiceFoco].id);
    }
  };

  const esFiltrado = value !== 'ALL';
  const esSinLocal = value === 'SIN_LOCAL';

  return (
    <div ref={containerRef} className="local-selector" onKeyDown={abierto ? handleMenuKeyDown : undefined}>
      <button
        type="button"
        className={`local-selector-trigger ${abierto ? 'is-open' : ''} ${esFiltrado ? (esSinLocal ? 'is-active-warn' : 'is-active') : ''}`}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-label="Filtrar por local"
        onClick={() => setAbierto((v) => !v)}
      >
        <span className={`local-selector-icon ${esSinLocal ? 'tone-warn' : ''}`} aria-hidden="true">
          <FiMapPin size={13} />
        </span>

        <span className="local-selector-text">
          {localActivo ? (
            <>
              <span className="local-selector-prefix">Local:</span>
              <span className="local-selector-value">{localActivo.nombre}</span>
            </>
          ) : esSinLocal ? (
            <>
              <span className="local-selector-prefix">Local:</span>
              <span className="local-selector-value">Sin local asignado</span>
            </>
          ) : (
            <>
              <span className="local-selector-prefix">Local:</span>
              <span className="local-selector-value">Todos</span>
              <span className="local-selector-count">{locales.length}</span>
            </>
          )}
        </span>

        {esFiltrado && (
          <span
            role="button"
            tabIndex={0}
            className="local-selector-clear"
            title="Mostrar todos los locales"
            aria-label="Quitar filtro de local"
            onClick={(e) => {
              e.stopPropagation();
              seleccionar('ALL');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                seleccionar('ALL');
              }
            }}
          >
            <FiX size={12} />
          </span>
        )}

        <FiChevronDown
          size={14}
          aria-hidden="true"
          className={`local-selector-chevron ${abierto ? 'is-rotated' : ''}`}
        />
      </button>

      {abierto && (
        <div
          role="listbox"
          aria-label="Locales disponibles"
          className={`local-selector-menu ${align === 'right' ? 'align-right' : 'align-left'}`}
        >
          <div className="local-selector-header">
            <span>FILTRAR POR LOCAL</span>
            <span className="local-selector-header-badge">{locales.length} locales</span>
          </div>

          {locales.length > 5 && (
            <div className="local-selector-search">
              <FiSearch size={13} className="local-selector-search-icon" aria-hidden="true" />
              <input
                ref={searchInputRef}
                type="text"
                className="local-selector-search-input"
                placeholder="Buscar local o serie (ej. F635)..."
                value={busqueda}
                onChange={(e) => {
                  setBusqueda(e.target.value);
                  setIndiceFoco(0);
                }}
              />
              {busqueda && (
                <button
                  type="button"
                  className="local-selector-search-clear"
                  onClick={() => setBusqueda('')}
                  aria-label="Limpiar búsqueda"
                >
                  <FiX size={12} />
                </button>
              )}
            </div>
          )}

          <div className="local-selector-list">
            {opciones.map((opt, idx) => {
              const isSelected = value === opt.id;
              const isFocused = indiceFoco === idx;

              if (opt.tipo === 'all') {
                return (
                  <button
                    key="ALL"
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`local-selector-item ${isSelected ? 'is-selected' : ''} ${isFocused ? 'is-focused' : ''}`}
                    onMouseEnter={() => setIndiceFoco(idx)}
                    onClick={() => seleccionar('ALL')}
                  >
                    <div className="local-selector-item-main">
                      <div className="local-selector-item-title-row">
                        <FiLayers size={13} className="text-primary flex-shrink-0" aria-hidden="true" />
                        <span className="local-selector-item-name">Todos los locales</span>
                      </div>
                      <span className="local-selector-item-sub">
                        Mostrar comprobantes de los {locales.length} locales configurados
                      </span>
                    </div>
                    {isSelected && <FiCheck size={14} className="local-selector-check" aria-hidden="true" />}
                  </button>
                );
              }

              if (opt.tipo === 'sin_local') {
                return (
                  <React.Fragment key="SIN_LOCAL">
                    <div className="local-selector-divider" />
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`local-selector-item ${isSelected ? 'is-selected-warn' : ''} ${isFocused ? 'is-focused' : ''}`}
                      onMouseEnter={() => setIndiceFoco(idx)}
                      onClick={() => seleccionar('SIN_LOCAL')}
                    >
                      <div className="local-selector-item-main">
                        <div className="local-selector-item-title-row">
                          <FiAlertCircle size={13} className="text-warning flex-shrink-0" aria-hidden="true" />
                          <span className="local-selector-item-name">Sin local asignado</span>
                        </div>
                        <span className="local-selector-item-sub">
                          Series que aún no pertenecen a ningún local
                        </span>
                      </div>
                      {isSelected && <FiCheck size={14} className="local-selector-check text-warning" aria-hidden="true" />}
                    </button>
                  </React.Fragment>
                );
              }

              const loc = opt.local;
              const facs = loc.seriesPorTipo?.['01'] || [];
              const bols = loc.seriesPorTipo?.['03'] || [];
              const notas = [...(loc.seriesPorTipo?.['07'] || []), ...(loc.seriesPorTipo?.['08'] || [])];

              return (
                <button
                  key={loc.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`local-selector-item ${isSelected ? 'is-selected' : ''} ${isFocused ? 'is-focused' : ''}`}
                  onMouseEnter={() => setIndiceFoco(idx)}
                  onClick={() => seleccionar(loc.id)}
                >
                  <div className="local-selector-item-main">
                    <span className="local-selector-item-name">{loc.nombre}</span>
                    <div className="local-selector-pills">
                      {facs.map((s) => (
                        <span key={`01-${s}`} className="local-series-pill tone-fac">{s}</span>
                      ))}
                      {bols.map((s) => (
                        <span key={`03-${s}`} className="local-series-pill tone-bol">{s}</span>
                      ))}
                      {notas.map((s) => (
                        <span key={`07-${s}`} className="local-series-pill tone-nc">{s}</span>
                      ))}
                    </div>
                  </div>
                  {isSelected && <FiCheck size={14} className="local-selector-check" aria-hidden="true" />}
                </button>
              );
            })}

            {localesFiltrados.length === 0 && busqueda.trim() !== '' && (
              <div className="local-selector-empty">
                No hay locales ni series que coincidan con &ldquo;{busqueda}&rdquo;.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default SelectorLocal;
