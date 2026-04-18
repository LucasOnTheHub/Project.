/**
 * Project. App — M6
 *
 * Détecte si plusieurs vaults sont configurés (getGalaxyRoots).
 * - 1 vault  → mode Solo : GraphCanvas3D (comportement M5 inchangé)
 * - N vaults → mode Galaxie : GalaxyCanvas3D avec switcher Solo/Galaxie
 *
 * Le switcher "🌌 Galaxie / ⭐ Solo" est toujours affiché quand N > 1.
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { ProjectGraph } from '../types/index.js';
import type { GalaxyGraph } from '../types/galaxy.js';
import { GraphCanvas3D } from './components/GraphCanvas3D.js';
import { GalaxyCanvas3D } from './components/GalaxyCanvas3D.js';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  root: {
    width: '100vw',
    height: '100vh',
    background: '#0d0d14',
    color: '#e0e0f0',
    fontFamily: '"Inter", "SF Pro Display", system-ui, sans-serif',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 20px',
    background: 'rgba(255,255,255,0.03)',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  title: {
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: 0.5,
    color: '#c0b8ff',
  },
  vault: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.35)',
    marginLeft: 4,
  },
  badge: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    background: 'rgba(255,255,255,0.05)',
    padding: '2px 8px',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.08)',
  },
  modeBtn: {
    marginLeft: 'auto',
    fontSize: 12,
    cursor: 'pointer',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    color: '#c0b8ff',
    padding: '4px 12px',
  },
  canvas: {
    flex: 1,
    minHeight: 0,
  },
  loading: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    color: 'rgba(255,255,255,0.3)',
    gap: 10,
  },
  error: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    gap: 8,
    color: '#ff6b6b',
    fontSize: 14,
  },
};

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

type ViewMode = 'solo' | 'galaxy';

export function App() {
  const [graph,    setGraph]    = useState<ProjectGraph | null>(null);
  const [galaxy,   setGalaxy]   = useState<GalaxyGraph | null>(null);
  const [vault,    setVault]    = useState<string>('');
  const [roots,    setRoots]    = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('solo');
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(true);

  const isMultiVault = roots.length > 1;

  // ── Load solo graph ───────────────────────────────────────────────────────

  const loadGraph = useCallback(async () => {
    try {
      const [g, v] = await Promise.all([
        window.projectAPI.getGraph(),
        window.projectAPI.getVault(),
      ]);
      setGraph(g);
      setVault(v);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  // ── Load galaxy ───────────────────────────────────────────────────────────

  const loadGalaxy = useCallback(async () => {
    try {
      const g = await window.projectAPI.getGalaxy();
      setGalaxy(g);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  // ── Boot ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const boot = async () => {
      setLoading(true);
      try {
        const r = await window.projectAPI.getGalaxyRoots();
        setRoots(r);

        if (r.length > 1) {
          // Multi-vault: start in galaxy mode, also load solo graph for switching
          setViewMode('galaxy');
          await Promise.all([loadGraph(), loadGalaxy()]);
        } else {
          await loadGraph();
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    };
    boot();
  }, [loadGraph, loadGalaxy]);

  // ── Refresh handlers ──────────────────────────────────────────────────────

  const handleRefresh = useCallback(async () => {
    await loadGraph();
    if (isMultiVault) await loadGalaxy();
  }, [loadGraph, loadGalaxy, isMultiVault]);

  // ── Render ────────────────────────────────────────────────────────────────

  const toggleMode = useCallback(() => {
    setViewMode((m) => m === 'solo' ? 'galaxy' : 'solo');
  }, []);

  // Header info depends on current mode
  const headerBadge = viewMode === 'galaxy' && galaxy
    ? `${galaxy.stars.length} projets · ${galaxy.totalNodes} nœuds`
    : graph
    ? `${graph.nodes.length} nodes · ${graph.edges.length} edges`
    : null;

  const headerVault = viewMode === 'solo' ? vault : '';

  return (
    <div style={styles.root}>
      <header style={styles.header}>
        <span style={styles.title}>Project.</span>
        {headerVault && <span style={styles.vault}>{headerVault}</span>}
        {headerBadge && <span style={styles.badge}>{headerBadge}</span>}

        {/* Mode switcher — only visible when multiple vaults are configured */}
        {isMultiVault && (
          <button style={styles.modeBtn} onClick={toggleMode}>
            {viewMode === 'solo' ? '🌌 Galaxie' : '⭐ Solo'}
          </button>
        )}
      </header>

      {error ? (
        <div style={styles.error}>
          <span>⚠ Failed to load graph</span>
          <code style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{error}</code>
        </div>
      ) : loading ? (
        <div style={styles.loading}>
          <span>◌</span>
          {isMultiVault ? 'Chargement de la galaxie…' : 'Loading vault…'}
        </div>
      ) : viewMode === 'galaxy' && galaxy ? (
        <div style={styles.canvas}>
          <GalaxyCanvas3D
            galaxy={galaxy}
            onBack={isMultiVault ? () => setViewMode('solo') : undefined}
          />
        </div>
      ) : graph ? (
        <div style={styles.canvas}>
          <GraphCanvas3D graph={graph} onGraphRefresh={handleRefresh} />
        </div>
      ) : (
        <div style={styles.loading}>Aucun graphe disponible</div>
      )}
    </div>
  );
}
