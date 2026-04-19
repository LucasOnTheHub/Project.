/**
 * MultiVaultReader (M6)
 *
 * Scans multiple vault directories in parallel and assembles a GalaxyGraph.
 */

import { VaultReader } from './vault-reader.js';
import type { GalaxyGraph, GalaxyStar } from '../types/galaxy.js';

const STAR_PALETTE: number[] = [
  0xf0c060,
  0x60a8ff,
  0xff8c6b,
  0x7cfc8a,
  0xd4a8ff,
  0xff6b9d,
  0x70d8d8,
  0xffd166,
];

function starColor(name: string, index: number): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) + h) ^ name.charCodeAt(i);
    h = h >>> 0;
  }
  return STAR_PALETTE[(h + index) % STAR_PALETTE.length];
}

function computeOffset(i: number, total: number): { x: number; y: number; z: number } {
  if (total === 1) return { x: 0, y: 0, z: 0 };
  const radius = Math.max(60, total * 18);
  const angle = (2 * Math.PI * i) / total;
  return {
    x: Math.cos(angle) * radius,
    y: 0,
    z: Math.sin(angle) * radius,
  };
}

export class MultiVaultReader {
  private readers: VaultReader[];

  constructor(private vaultRoots: string[]) {
    this.readers = vaultRoots.map((root) => new VaultReader(root));
  }

  async scanAll(): Promise<GalaxyGraph> {
    const total = this.vaultRoots.length;
    const results = await Promise.allSettled(
      this.readers.map((reader) => reader.scan()),
    );

    const stars: GalaxyStar[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        console.error(
          `[MultiVaultReader] Failed to scan vault "${this.vaultRoots[i]}":`,
          result.reason,
        );
        continue;
      }

      const graph = result.value;
      stars.push({
        vaultRoot: this.vaultRoots[i],
        graph,
        offset: computeOffset(i, total),
        starColor: starColor(graph.name, i),
      });
    }

    const totalNodes = stars.reduce((acc, s) => acc + s.graph.nodes.length, 0);
    const totalEdges = stars.reduce((acc, s) => acc + s.graph.edges.length, 0);

    return { stars, totalNodes, totalEdges };
  }
}
