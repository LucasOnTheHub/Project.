/**
 * TaskPanel — M4
 *
 * Panneau latéral gauche affichant toutes les tâches du graphe sous forme
 * de liste avec checkboxes. Les sous-tâches (champ `parent`) sont indentées
 * sous leur tâche parente.
 *
 * Interaction :
 *   - Clic checkbox → appelle window.projectAPI.toggleTask(path)
 *   - Clic sur le titre → sélectionne le node dans la scène 3D
 *   - Compteur de progression (done / total)
 */

import React, { useCallback, useState } from 'react';
import type { ProjectGraph, ProjectNode, TaskMetadata } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Types helpers
// ---------------------------------------------------------------------------

interface TaskNode {
  node: ProjectNode;
  meta: TaskMetadata;
  children: TaskNode[];
}

function buildTaskTree(graph: ProjectGraph): TaskNode[] {
  const tasks = graph.nodes.filter((n) => n.metadata.type === 'task');
  const byPath = new Map<string, TaskNode>(
    tasks.map((n) => [n.path, { node: n, meta: n.metadata as TaskMetadata, children: [] }]),
  );

  const roots: TaskNode[] = [];

  for (const tn of byPath.values()) {
    const parentPath = tn.meta.parent;
    if (parentPath && byPath.has(parentPath)) {
      byPath.get(parentPath)!.children.push(tn);
    } else {
      roots.push(tn);
    }
  }

  // Sort: undone first, then by path
  const sort = (list: TaskNode[]) =>
    list.sort((a, b) => {
      if (a.meta.done !== b.meta.done) return a.meta.done ? 1 : -1;
      return a.node.path.localeCompare(b.node.path);
    });

  const sortDeep = (list: TaskNode[]): TaskNode[] =>
    sort(list).map((t) => ({ ...t, children: sortDeep(t.children) }));

  return sortDeep(roots);
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#ff4444',
  high:     '#ff8c6b',
  medium:   '#ffd166',
  low:      '#6bffb8',
};

// ---------------------------------------------------------------------------
// TaskRow
// ---------------------------------------------------------------------------

interface TaskRowProps {
  taskNode: TaskNode;
  depth: number;
  selected: string | null;
  onSelect: (path: string | null) => void;
  onToggle: (path: string) => void;
  toggling: Set<string>;
}

function TaskRow({ taskNode, depth, selected, onSelect, onToggle, toggling }: TaskRowProps) {
  const { node, meta, children } = taskNode;
  const isSelected = selected === node.path;
  const isToggling = toggling.has(node.path);
  const isDone = Boolean(meta.done);
  const priorityColor = meta.priority ? PRIORITY_COLORS[meta.priority] : undefined;

  const title = node.path.split('/').pop()?.replace(/\.md$/, '') ?? node.path;

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: `5px 10px 5px ${14 + depth * 18}px`,
          borderRadius: 6,
          margin: '1px 4px',
          cursor: 'pointer',
          background: isSelected ? 'rgba(255,140,107,0.12)' : 'transparent',
          border: isSelected ? '1px solid rgba(255,140,107,0.25)' : '1px solid transparent',
          transition: 'background 0.15s',
        }}
        onClick={() => onSelect(isSelected ? null : node.path)}
        title={node.path}
      >
        {/* Checkbox */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(node.path); }}
          disabled={isToggling}
          style={{
            flexShrink: 0,
            width: 16,
            height: 16,
            borderRadius: 4,
            border: `1.5px solid ${isDone ? '#6bffb8' : 'rgba(255,255,255,0.3)'}`,
            background: isDone ? 'rgba(107,255,184,0.15)' : 'transparent',
            cursor: isToggling ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            transition: 'all 0.15s',
          }}
          aria-label={isDone ? 'Mark as active' : 'Mark as done'}
        >
          {isDone && (
            <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
              <path d="M1 3.5L3.5 6L8 1" stroke="#6bffb8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </button>

        {/* Priority dot */}
        {priorityColor && (
          <div style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: priorityColor,
            flexShrink: 0,
            boxShadow: `0 0 4px ${priorityColor}`,
          }} title={`Priority: ${meta.priority}`} />
        )}

        {/* Title */}
        <span style={{
          fontSize: 12,
          color: isDone ? 'rgba(255,255,255,0.25)' : (isSelected ? '#ff8c6b' : 'rgba(255,255,255,0.75)'),
          textDecoration: isDone ? 'line-through' : 'none',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
          transition: 'color 0.15s',
        }}>
          {title}
        </span>

        {/* Due date */}
        {meta.due && !isDone && (
          <span style={{
            fontSize: 10,
            color: 'rgba(255,255,255,0.2)',
            flexShrink: 0,
          }}>
            {meta.due}
          </span>
        )}

        {/* Children count badge */}
        {children.length > 0 && (
          <span style={{
            fontSize: 9,
            color: 'rgba(255,140,107,0.5)',
            background: 'rgba(255,140,107,0.08)',
            borderRadius: 8,
            padding: '1px 5px',
            flexShrink: 0,
          }}>
            {children.filter((c) => !c.meta.done).length}/{children.length}
          </span>
        )}
      </div>

      {/* Sub-tasks */}
      {children.map((child) => (
        <TaskRow
          key={child.node.path}
          taskNode={child}
          depth={depth + 1}
          selected={selected}
          onSelect={onSelect}
          onToggle={onToggle}
          toggling={toggling}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// TaskPanel
// ---------------------------------------------------------------------------

interface TaskPanelProps {
  graph: ProjectGraph;
  selected: string | null;
  onSelect: (path: string | null) => void;
  /** Called after a task is toggled so the parent can refresh the graph */
  onGraphRefresh?: () => void;
}

export function TaskPanel({ graph, selected, onSelect, onGraphRefresh }: TaskPanelProps) {
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(true);

  const tree = buildTaskTree(graph);
  const allTasks = graph.nodes.filter((n) => n.metadata.type === 'task');
  const doneTasks = allTasks.filter((n) => (n.metadata as TaskMetadata).done);

  const handleToggle = useCallback(async (path: string) => {
    setToggling((prev) => new Set(prev).add(path));
    try {
      await window.projectAPI.toggleTask(path);
      onGraphRefresh?.();
    } catch (err) {
      console.error('[TaskPanel] toggleTask failed:', err);
    } finally {
      setToggling((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }, [onGraphRefresh]);

  if (allTasks.length === 0) return null;

  return (
    <div style={{
      position: 'absolute',
      left: 12,
      top: 12,
      width: 240,
      maxHeight: 'calc(100% - 80px)',
      background: 'rgba(10,10,18,0.88)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 10,
      backdropFilter: 'blur(14px)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 50,
      boxShadow: '0 4px 32px rgba(0,0,0,0.4)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          background: 'none',
          border: 'none',
          borderBottom: open ? '1px solid rgba(255,255,255,0.06)' : 'none',
          cursor: 'pointer',
          color: '#e0e0f0',
          width: '100%',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 11, color: '#ff8c6b', fontWeight: 700, letterSpacing: 0.5 }}>▲ TASKS</span>

        {/* Progress bar */}
        <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${allTasks.length > 0 ? (doneTasks.length / allTasks.length) * 100 : 0}%`,
            background: 'linear-gradient(90deg, #6bffb8, #60a8ff)',
            borderRadius: 2,
            transition: 'width 0.3s ease',
          }} />
        </div>

        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>
          {doneTasks.length}/{allTasks.length}
        </span>

        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginLeft: 2 }}>
          {open ? '▴' : '▾'}
        </span>
      </button>

      {/* Task list */}
      {open && (
        <div style={{ overflowY: 'auto', padding: '4px 0' }}>
          {tree.map((tn) => (
            <TaskRow
              key={tn.node.path}
              taskNode={tn}
              depth={0}
              selected={selected}
              onSelect={onSelect}
              onToggle={handleToggle}
              toggling={toggling}
            />
          ))}
        </div>
      )}
    </div>
  );
}
