/**
 * Project. — Galaxy types (M6)
 */

import type { ProjectGraph, ProjectNode, ProjectEdge } from './index.js';

export interface GalaxyStar {
  vaultRoot: string;
  graph: ProjectGraph;
  offset: { x: number; y: number; z: number };
  starColor: number;
}

export interface GalaxyGraph {
  stars: GalaxyStar[];
  totalNodes: number;
  totalEdges: number;
}
