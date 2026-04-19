/**
 * Project. — Core type definitions
 */

export type NodeType = 'master' | 'doc' | 'code' | 'asset' | 'task' | 'note' | 'reminder';
export type NodeStatus = 'draft' | 'active' | 'done' | 'archived';

export interface NodeMetadata {
  type: NodeType;
  project: string;
  gravity: number;
  links: string[];
  tags: string[];
  status: NodeStatus;
  created: string;
  [key: string]: unknown;
}

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
  trigger: string;
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

export interface ProjectNode {
  path: string;
  metadata: NodeMetadata;
  content?: string;
}

export interface ProjectEdge {
  from: string;
  to: string;
  kind: 'link' | 'tag';
}

export interface ProjectGraph {
  name: string;
  master: ProjectNode;
  nodes: ProjectNode[];
  edges: ProjectEdge[];
}

export interface VaultConfig {
  vault: { name: string; version: string; created: string; };
  index: { path: string; fts: boolean; };
  watcher: { include: string[]; exclude: string[]; };
  sidecar: { suffix: string; directory: string; };
  mcp: { default_scope: string; agents: Record<string, string[]>; };
}

export interface ParsedFile {
  path: string;
  metadata: NodeMetadata;
  body: string;
  sidecar: boolean;
}
