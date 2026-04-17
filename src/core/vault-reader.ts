/**
 * VaultReader
 *
 * Scans and watches a vault directory for trackable files.
 * Parses front-matter, builds the in-memory graph, and emits events
 * when files are added, changed, or removed.
 *
 * Guideline refs: §3 (architecture), §5 (watcher config).
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import yaml from 'js-yaml';
import { FrontMatterParser } from './front-matter.js';
import type { ProjectNode, ProjectEdge, ProjectGraph, VaultConfig } from '../types/index.js';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface VaultEvents {
  'node:added': (node: ProjectNode) => void;
  'node:changed': (node: ProjectNode) => void;
  'node:removed': (path: string) => void;
  'ready': () => void;
  'error': (err: Error) => void;
}

// ---------------------------------------------------------------------------
// VaultReader
// ---------------------------------------------------------------------------

export class VaultReader extends EventEmitter {
  private parser: FrontMatterParser;
  private nodes: Map<string, ProjectNode> = new Map();
  private watcher: FSWatcher | null = null;
  private config: VaultConfig | null = null;

  constructor(private vaultRoot: string) {
    super();
    this.parser = new FrontMatterParser(vaultRoot);
  }

  /**
   * Load vault config from .project/config.yml
   */
  async loadConfig(): Promise<VaultConfig> {
    const configPath = join(this.vaultRoot, '.project', 'config.yml');
    const raw = await readFile(configPath, 'utf-8');
    this.config = yaml.load(raw) as VaultConfig;
    return this.config;
  }

  /**
   * Full scan of the vault — reads every trackable file and builds the graph.
   */
  async scan(): Promise<ProjectGraph> {
    if (!this.config) await this.loadConfig();

    const files = await this.collectFiles();
    this.nodes.clear();

    for (const filePath of files) {
      try {
        const parsed = await this.parser.parse(filePath);
        const node: ProjectNode = {
          path: parsed.path,
          metadata: parsed.metadata,
        };
        this.nodes.set(filePath, node);
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
    }

    return this.buildGraph();
  }

  /**
   * Start watching the vault for file changes (chokidar).
   */
  startWatching(): void {
    if (this.watcher) return;

    const ignored = this.config?.watcher.exclude ?? [
      'node_modules/**',
      'dist/**',
      '.project/**',
      '.git/**',
      '**/*.project.yml',
    ];

    this.watcher = watch(this.vaultRoot, {
      ignored: ignored.map((p) => join(this.vaultRoot, p)),
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on('add', (absPath) => this.handleFileChange(absPath, 'added'));
    this.watcher.on('change', (absPath) => this.handleFileChange(absPath, 'changed'));
    this.watcher.on('unlink', (absPath) => {
      const rel = relative(this.vaultRoot, absPath);
      this.nodes.delete(rel);
      this.emit('node:removed', rel);
    });

    this.watcher.on('ready', () => this.emit('ready'));
  }

  /**
   * Stop watching.
   */
  async stopWatching(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Build the full graph from current in-memory nodes.
   */
  buildGraph(): ProjectGraph {
    const nodesArray = Array.from(this.nodes.values());

    // Find the master node (type: master)
    const master = nodesArray.find((n) => n.metadata.type === 'master');

    // Build edges from explicit links
    const edges: ProjectEdge[] = [];
    for (const node of nodesArray) {
      for (const link of node.metadata.links) {
        edges.push({ from: node.path, to: link, kind: 'link' });
      }
    }

    // Build tag-based affinity edges
    const tagMap = new Map<string, string[]>();
    for (const node of nodesArray) {
      for (const tag of node.metadata.tags) {
        const existing = tagMap.get(tag) ?? [];
        existing.push(node.path);
        tagMap.set(tag, existing);
      }
    }
    for (const [_tag, paths] of tagMap) {
      for (let i = 0; i < paths.length; i++) {
        for (let j = i + 1; j < paths.length; j++) {
          edges.push({ from: paths[i], to: paths[j], kind: 'tag' });
        }
      }
    }

    return {
      name: this.config?.vault.name ?? 'unnamed',
      master: master ?? nodesArray[0],
      nodes: nodesArray,
      edges,
    };
  }

  /**
   * Get a single node by path.
   */
  getNode(path: string): ProjectNode | undefined {
    return this.nodes.get(path);
  }

  /**
   * Get all nodes.
   */
  getAllNodes(): ProjectNode[] {
    return Array.from(this.nodes.values());
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async collectFiles(): Promise<string[]> {
    const results: string[] = [];
    const excludePatterns = this.config?.watcher.exclude ?? [];

    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const rel = relative(this.vaultRoot, fullPath);

        // Simple exclusion check
        if (this.shouldExclude(rel, excludePatterns)) continue;

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && !rel.endsWith('.project.yml')) {
          results.push(rel);
        }
      }
    };

    await walk(this.vaultRoot);
    return results;
  }

  private shouldExclude(relPath: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      const base = pattern.replace(/\*\*\/?\*?/g, '').replace(/\/$/, '');
      if (base && relPath.startsWith(base)) return true;
    }
    return false;
  }

  private async handleFileChange(
    absPath: string,
    event: 'added' | 'changed',
  ): Promise<void> {
    const rel = relative(this.vaultRoot, absPath);
    if (rel.endsWith('.project.yml')) return;

    try {
      const parsed = await this.parser.parse(rel);
      const node: ProjectNode = {
        path: parsed.path,
        metadata: parsed.metadata,
      };
      this.nodes.set(rel, node);
      this.emit(event === 'added' ? 'node:added' : 'node:changed', node);
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }
}
