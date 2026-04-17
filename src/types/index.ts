/**
 * Project. — Core type definitions
 *
 * These types map directly to the metadata schema defined in guideline.md §4.
 * Rule: any unknown field is preserved as-is (never stripped).
 */

// ---------------------------------------------------------------------------
// Node types
// ---------------------------------------------------------------------------

export type NodeType = 'master' | 'doc' | 'code' | 'asset' | 'task' | 'note' | 'reminder';
export type NodeStatus = 'draft' | 'active' | 'done' | 'archived';

/**
 * Base metadata present on every trackable file.
 * Additional unknown fields are kept in `extra`.
 */
export interface NodeMetadata {
  type: NodeType;
  project: string;
  gravity: number; // 0.0 → 1.0
  links: string[];
  tags: string[];
  status: NodeStatus;
  created: string; // ISO date YYYY-MM-DD
  /** Any field the system doesn't recognize — preserved verbatim. */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Type-specific extensions (§4)
// ---------------------------------------------------------------------------

export interface TaskMetadata extends NodeMetadata {
  type: 'task';
  due?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  parent?: string;
  assignee?: string;
  done: boolean;
}

export interface ReminderMetadata extends NodeMetadata {
  type: 'reminder';
  trigger: string; // cron expression or ISO date
  channel: 'notif' | 'mcp' | 'email';
  recurring: boolean;
}

export interface CodeMetadata extends NodeMetadata {
  type: 'code';
  language?: string;
  entrypoint?: boolean;
}

export interface AssetMetadata extends NodeMetadata {
  type: 'asset';
  mime?: string;
  size?: number;
}

// ---------------------------------------------------------------------------
// Graph model
// ---------------------------------------------------------------------------

export interface ProjectNode {
  /** Relative path from vault root (e.g. "src/main.py") */
  path: string;
  metadata: NodeMetadata;
  /** Raw file content (populated on demand, not always loaded) */
  content?: string;
}

export interface ProjectEdge {
  from: string; // path
  to: string; // path
  /** Edge source: 'link' (explicit in front-matter) or 'tag' (shared tag affinity) */
  kind: 'link' | 'tag';
}

export interface ProjectGraph {
  name: string;
  master: ProjectNode;
  nodes: ProjectNode[];
  edges: ProjectEdge[];
}

// ---------------------------------------------------------------------------
// Vault config (.project/config.yml)
// ---------------------------------------------------------------------------

export interface VaultConfig {
  vault: {
    name: string;
    version: string;
    created: string;
  };
  index: {
    path: string;
    fts: boolean;
  };
  watcher: {
    include: string[];
    exclude: string[];
  };
  sidecar: {
    suffix: string;
    directory: string;
  };
  mcp: {
    default_scope: string;
    agents: Record<string, string[]>;
  };
}

// ---------------------------------------------------------------------------
// Parsed file result
// ---------------------------------------------------------------------------

export interface ParsedFile {
  /** Relative path from vault root */
  path: string;
  metadata: NodeMetadata;
  /** Body content after front-matter */
  body: string;
  /** Whether metadata came from a sidecar (.project.yml) rather than inline front-matter */
  sidecar: boolean;
}
