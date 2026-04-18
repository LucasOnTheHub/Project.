/**
 * GitPanel — M5
 *
 * Panneau latéral droit affichant l'état git du vault.
 * Miroir visuel de TaskPanel (côté droit, même style dark).
 *
 * Sections :
 *   - Header : branche + badge ahead/behind
 *   - Changed files : liste des fichiers modifiés / non-trackés
 *   - Commit button : commit rapide avec message auto ou personnalisé
 *   - Log : les N derniers commits
 *
 * Utilise window.projectAPI.gitStatus / gitCommit / gitLog / gitInit
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { GitStatusResult, GitCommitResult, GitLogEntry } from '../../types/git.js';

// ---------------------------------------------------------------------------
// Panel styles (inline, same approach as TaskPanel)
// ---------------------------------------------------------------------------

const PANEL: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  width: 260,
  height: '100%',
  background: 'rgba(13,13,20,0.92)',
  borderLeft: '1px solid rgba(255,255,255,0.08)',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: "'Segoe UI', system-ui, sans-serif",
  fontSize: 12,
  color: '#cdd6f4',
  zIndex: 20,
  backdropFilter: 'blur(6px)',
  overflowY: 'auto',
  userSelect: 'none',
};

const HEADER: React.CSSProperties = {
  padding: '14px 14px 10px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const SECTION_TITLE: React.CSSProperties = {
  padding: '8px 14px 4px',
  fontSize: 10,
  letterSpacing: 1,
  textTransform: 'uppercase',
  color: 'rgba(205,214,244,0.45)',
};

const FILE_ROW: React.CSSProperties = {
  padding: '3px 14px',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
};

const COMMIT_AREA: React.CSSProperties = {
  padding: '8px 14px',
  borderTop: '1px solid rgba(255,255,255,0.06)',
};

const INPUT: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 4,
  color: '#cdd6f4',
  padding: '5px 8px',
  fontSize: 12,
  marginBottom: 6,
  boxSizing: 'border-box',
};

const BTN = (disabled: boolean): React.CSSProperties => ({
  width: '100%',
  padding: '6px 0',
  borderRadius: 4,
  border: 'none',
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontSize: 12,
  fontWeight: 600,
  background: disabled ? 'rgba(137,180,250,0.2)' : '#89b4fa',
  color: disabled ? 'rgba(13,13,20,0.5)' : '#0d0d14',
  transition: 'background 0.15s',
});

const LOG_ROW: React.CSSProperties = {
  padding: '4px 14px',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FileStatus({ path, kind }: { path: string; kind: 'staged' | 'modified' | 'untracked' }) {
  const colors: Record<string, string> = {
    staged: '#a6e3a1',
    modified: '#f9e2af',
    untracked: '#89b4fa',
  };
  const labels: Record<string, string> = {
    staged: 'S',
    modified: 'M',
    untracked: 'U',
  };
  return (
    <div style={FILE_ROW}>
      <span style={{ color: colors[kind], minWidth: 14, textAlign: 'center', fontWeight: 700 }}>
        {labels[kind]}
      </span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', opacity: 0.85 }} title={path}>
        {path}
      </span>
    </div>
  );
}

function LogEntry({ entry }: { entry: GitLogEntry }) {
  return (
    <div style={LOG_ROW}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
        <span style={{ color: '#89b4fa', fontFamily: 'monospace', fontSize: 11 }}>{entry.hash}</span>
        <span style={{ opacity: 0.5, fontSize: 10 }}>{entry.date.slice(0, 10)}</span>
      </div>
      <div style={{ opacity: 0.8, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {entry.message}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GitPanel
// ---------------------------------------------------------------------------

interface GitPanelProps {
  onRefresh?: () => void; // optional — notify parent after commit
}

export function GitPanel({ onRefresh }: GitPanelProps) {
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [log, setLog] = useState<GitLogEntry[]>([]);
  const [commitMsg, setCommitMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<string>('');

  const api = (window as Window & typeof globalThis & { projectAPI?: Record<string, (...args: unknown[]) => Promise<unknown>> }).projectAPI;

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const [s, l] = await Promise.all([
        api.gitStatus() as Promise<GitStatusResult>,
        api.gitLog(10) as Promise<GitLogEntry[]>,
      ]);
      setStatus(s);
      setLog(l);
    } catch {
      // git not available or not a repo
      setStatus({ isRepo: false, branch: '', staged: [], modified: [], untracked: [], ahead: 0, behind: 0 });
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleInit = useCallback(async () => {
    if (!api) return;
    setBusy(true);
    try {
      const msg = await api.gitInit() as string;
      setLastResult(msg);
      await refresh();
    } catch (e) {
      setLastResult(String(e));
    } finally {
      setBusy(false);
    }
  }, [api, refresh]);

  const handleCommit = useCallback(async () => {
    if (!api) return;
    setBusy(true);
    try {
      const result = await api.gitCommit(commitMsg || undefined) as GitCommitResult;
      setLastResult(result.summary);
      setCommitMsg('');
      await refresh();
      onRefresh?.();
    } catch (e) {
      setLastResult(String(e));
    } finally {
      setBusy(false);
    }
  }, [api, commitMsg, refresh, onRefresh]);

  if (!api) {
    return null;
  }

  const totalChanged = (status?.staged?.length ?? 0) + (status?.modified?.length ?? 0) + (status?.untracked?.length ?? 0);

  return (
    <div style={PANEL}>
      {/* ── Header ── */}
      <div style={HEADER}>
        <span style={{ fontSize: 16 }}>⎇</span>
        <span style={{ fontWeight: 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {status?.isRepo ? status.branch || 'HEAD' : 'No repo'}
        </span>
        {status?.isRepo && (status.ahead > 0 || status.behind > 0) && (
          <span style={{ fontSize: 10, color: '#f9e2af' }}>
            ↑{status.ahead} ↓{status.behind}
          </span>
        )}
        <button
          onClick={() => void refresh()}
          title="Refresh"
          style={{ background: 'none', border: 'none', color: '#89b4fa', cursor: 'pointer', fontSize: 14, padding: 0 }}
        >
          ↻
        </button>
      </div>

      {/* ── Not a repo → Init button ── */}
      {status && !status.isRepo && (
        <div style={{ padding: '12px 14px' }}>
          <div style={{ marginBottom: 8, opacity: 0.6, lineHeight: 1.4 }}>
            This vault is not a git repository.
          </div>
          <button style={BTN(busy)} disabled={busy} onClick={() => void handleInit()}>
            {busy ? 'Initialising…' : 'git init'}
          </button>
        </div>
      )}

      {/* ── Changed files ── */}
      {status?.isRepo && (
        <>
          <div style={SECTION_TITLE}>
            Changes{totalChanged > 0 && <span style={{ marginLeft: 6, color: '#f9e2af' }}>{totalChanged}</span>}
          </div>
          {totalChanged === 0 ? (
            <div style={{ padding: '4px 14px', opacity: 0.4 }}>Nothing to commit</div>
          ) : (
            <>
              {status.staged.map((f) => <FileStatus key={`s-${f}`} path={f} kind="staged" />)}
              {status.modified.map((f) => <FileStatus key={`m-${f}`} path={f} kind="modified" />)}
              {status.untracked.map((f) => <FileStatus key={`u-${f}`} path={f} kind="untracked" />)}
            </>
          )}

          {/* ── Commit area ── */}
          <div style={COMMIT_AREA}>
            <input
              style={INPUT}
              placeholder="Commit message (optional)"
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleCommit(); }}
            />
            <button
              style={BTN(busy || totalChanged === 0)}
              disabled={busy || totalChanged === 0}
              onClick={() => void handleCommit()}
            >
              {busy ? 'Committing…' : 'Commit all'}
            </button>
            {lastResult && (
              <div style={{ marginTop: 6, opacity: 0.6, fontSize: 11, wordBreak: 'break-word' }}>
                {lastResult}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Log ── */}
      {log.length > 0 && (
        <>
          <div style={SECTION_TITLE}>Recent commits</div>
          {log.map((e) => <LogEntry key={e.hash} entry={e} />)}
        </>
      )}
    </div>
  );
}
