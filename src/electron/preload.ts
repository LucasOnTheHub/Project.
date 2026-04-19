/**
 * Project. — Electron Preload Script (M6)
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { ProjectGraph, ProjectNode } from '../types/index.js';
import type { GitStatusResult, GitCommitResult, GitLogEntry } from '../types/git.js';
import type { GalaxyGraph } from '../types/galaxy.js';

export interface ProjectAPI {
  getGraph: () => Promise<ProjectGraph>;
  getVault: () => Promise<string>;
  toggleTask: (path: string) => Promise<ProjectNode>;
  gitStatus: () => Promise<GitStatusResult>;
  gitCommit: (message?: string) => Promise<GitCommitResult>;
  gitLog: (limit?: number) => Promise<GitLogEntry[]>;
  gitInit: () => Promise<string>;
  getGalaxy: () => Promise<GalaxyGraph>;
  getGalaxyRoots: () => Promise<string[]>;
}

contextBridge.exposeInMainWorld('projectAPI', {
  getGraph: (): Promise<ProjectGraph> => ipcRenderer.invoke('get-graph'),
  getVault: (): Promise<string> => ipcRenderer.invoke('get-vault'),
  toggleTask: (path: string): Promise<ProjectNode> => ipcRenderer.invoke('toggle-task', path),
  gitStatus: (): Promise<GitStatusResult> => ipcRenderer.invoke('git-status'),
  gitCommit: (message?: string): Promise<GitCommitResult> => ipcRenderer.invoke('git-commit', message),
  gitLog: (limit = 20): Promise<GitLogEntry[]> => ipcRenderer.invoke('git-log', limit),
  gitInit: (): Promise<string> => ipcRenderer.invoke('git-init'),
  getGalaxy: (): Promise<GalaxyGraph> => ipcRenderer.invoke('get-galaxy'),
  getGalaxyRoots: (): Promise<string[]> => ipcRenderer.invoke('get-galaxy-roots'),
} satisfies ProjectAPI);
