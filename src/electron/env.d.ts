/**
 * Augment the Window interface so the renderer TypeScript knows about projectAPI.
 */

import type { ProjectGraph, ProjectNode } from '../types/index.js';

interface ProjectAPI {
  getGraph: () => Promise<ProjectGraph>;
  getVault: () => Promise<string>;
  toggleTask: (path: string) => Promise<ProjectNode>;
}

declare global {
  interface Window {
    projectAPI: ProjectAPI;
  }
}
