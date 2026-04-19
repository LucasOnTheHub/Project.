/**
 * VaultManager
 *
 * Write layer on top of VaultReader + IndexDB.
 * Every operation is file-first: it writes to disk, then updates the index.
 */

import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import yaml from 'js-yaml';
import { FrontMatterParser } from './front-matter.js';
import { IndexDB } from './index-db.js';
import { createScheduler } from './reminder-scheduler.js';
import type { ReminderScheduler } from './reminder-scheduler.js';
import type {
  NodeMetadata,
  NodeType,
  NodeStatus,
  TaskMetadata,
  ReminderMetadata,
  ProjectNode,
  VaultConfig,
} from '../types/index.js';

const DEFAULT_CONFIG: VaultConfig = {
  vault: { name: '', version: '0.1.0', created: '' },
  index: { path: '.project/index.db', fts: true },
  watcher: {
    include: ['**/*'],
    exclude: ['node_modules/**', 'dist/**', '.project/**', '.git/**', '**/*.project.yml'],
  },
  sidecar: { suffix: '.project.yml', directory: '.project/sidecars' },
  mcp: {
    default_scope: 'read',
    agents: { 'claude-desktop': ['read', 'write', 'admin'] },
  },
};

export class VaultManager {
  private parser: FrontMatterParser;
  private _db: IndexDB | null = null;
  private scheduler: ReminderScheduler;

  constructor(public readonly vaultRoot: string) {
    this.parser = new FrontMatterParser(vaultRoot);
    this.scheduler = createScheduler();
  }

  getScheduler(): ReminderScheduler {
    return this.scheduler;
  }

  get db(): IndexDB {
    if (!this._db) {
      this._db = new IndexDB(this.vaultRoot);
    }
    return this._db;
  }

  async createProject(name: string, masterContent: string = ''): Promise<ProjectNode> {
    const projectDir = this.vaultRoot;
    await mkdir(join(projectDir, '.project', 'sidecars'), { recursive: true });

    const configPath = join(projectDir, '.project', 'config.yml');
    if (!existsSync(configPath)) {
      const config: VaultConfig = {
        ...DEFAULT_CONFIG,
        vault: { name, version: '0.1.0', created: today() },
      };
      await writeFile(configPath, yaml.dump(config), 'utf-8');
    }

    const masterPath = join(projectDir, 'guideline.md');
    if (!existsSync(masterPath)) {
      const metadata: NodeMetadata = {
        type: 'master',
        project: name,
        gravity: 1.0,
        links: [],
        tags: ['core'],
        status: 'active',
        created: today(),
      };
      const content = this.parser.stringify(metadata, masterContent || `# ${name}\n`);
      await writeFile(masterPath, content, 'utf-8');
    }

    const node = await this.parseAndIndex('guideline.md');
    return node;
  }

  async createNode(
    path: string,
    type: NodeType,
    content: string = '',
    metadata: Partial<NodeMetadata> = {},
  ): Promise<ProjectNode> {
    const absPath = join(this.vaultRoot, path);
    await mkdir(dirname(absPath), { recursive: true });

    const fullMeta: NodeMetadata = {
      type,
      project: metadata.project ?? '',
      gravity: metadata.gravity ?? 0.5,
      links: metadata.links ?? [],
      tags: metadata.tags ?? [],
      status: metadata.status ?? 'draft',
      created: metadata.created ?? today(),
      ...stripCoreFields(metadata),
    };

    const fileContent = this.parser.stringify(fullMeta, content);
    await writeFile(absPath, fileContent, 'utf-8');

    return this.parseAndIndex(path);
  }

  async updateNode(
    path: string,
    patch: Partial<NodeMetadata> & { content?: string },
  ): Promise<ProjectNode> {
    const absPath = join(this.vaultRoot, path);
    const raw = await readFile(absPath, 'utf-8');

    const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
    const match = FRONT_MATTER_RE.exec(raw);

    let existingMeta: Record<string, unknown> = {};
    let existingBody = raw;

    if (match) {
      existingMeta = (yaml.load(match[1]) as Record<string, unknown>) ?? {};
      existingBody = match[2];
    }

    const { content: newContent, ...metaPatch } = patch;
    const mergedMeta = { ...existingMeta, ...metaPatch } as NodeMetadata;
    const body = newContent !== undefined ? newContent : existingBody;

    const fileContent = this.parser.stringify(mergedMeta, body);
    await writeFile(absPath, fileContent, 'utf-8');

    return this.parseAndIndex(path);
  }

  async deleteNode(path: string): Promise<void> {
    const absPath = join(this.vaultRoot, path);
    await unlink(absPath);
    this.db.remove(path);
  }

  async linkNodes(from: string, to: string): Promise<ProjectNode> {
    const absPath = join(this.vaultRoot, from);
    const raw = await readFile(absPath, 'utf-8');

    const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
    const match = FRONT_MATTER_RE.exec(raw);

    if (!match) throw new Error(`No front-matter found in ${from}`);

    const meta = (yaml.load(match[1]) as Record<string, unknown>) ?? {};
    const links: string[] = Array.isArray(meta.links) ? (meta.links as string[]) : [];

    if (!links.includes(to)) {
      links.push(to);
      meta.links = links;
      const fileContent = this.parser.stringify(meta as NodeMetadata, match[2]);
      await writeFile(absPath, fileContent, 'utf-8');
    }

    return this.parseAndIndex(from);
  }

  async setGravity(path: string, value: number): Promise<ProjectNode> {
    const clamped = Math.max(0, Math.min(1, value));
    return this.updateNode(path, { gravity: clamped });
  }

  async createTask(
    project: string,
    title: string,
    opts: { parent?: string; due?: string; priority?: TaskMetadata['priority']; assignee?: string } = {},
  ): Promise<ProjectNode> {
    const slug = slugify(title);
    const path = `tasks/${slug}.md`;
    const meta: Partial<TaskMetadata> = {
      type: 'task',
      project,
      gravity: 0.7,
      status: 'active',
      done: false,
      ...opts,
    };
    return this.createNode(path, 'task', `# ${title}\n`, meta as Partial<NodeMetadata>);
  }

  async toggleTask(path: string): Promise<ProjectNode> {
    const node = this.db.get(path);
    if (!node) throw new Error(`Node not found: ${path}`);
    const currentDone = Boolean((node.metadata as TaskMetadata).done);
    return this.updateNode(path, {
      done: !currentDone,
      status: !currentDone ? 'done' : 'active',
    } as Partial<NodeMetadata>);
  }

  async createReminder(
    project: string,
    title: string,
    trigger: string,
    channel: ReminderMetadata['channel'] = 'notif',
    recurring: boolean = false,
  ): Promise<ProjectNode> {
    const slug = slugify(title);
    const path = `reminders/${slug}.md`;
    const meta: Partial<ReminderMetadata> = {
      type: 'reminder',
      project,
      gravity: 0.5,
      status: 'active',
      trigger,
      channel,
      recurring,
    };
    const node = await this.createNode(path, 'reminder', `# ${title}\n`, meta as Partial<NodeMetadata>);
    await this.scheduler.schedule({ id: path, title, trigger, recurring });
    return node;
  }

  listAllNodes(): ProjectNode[] { return this.db.listAll(); }
  search(query: string): ProjectNode[] { return this.db.search(query); }
  getNode(path: string): ProjectNode | null { return this.db.get(path); }

  private async parseAndIndex(path: string): Promise<ProjectNode> {
    const parsed = await this.parser.parse(path);
    const node: ProjectNode = { path: parsed.path, metadata: parsed.metadata };
    this.db.upsert(node);
    return node;
  }

  close(): void { this.db.close(); }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function stripCoreFields(meta: Partial<NodeMetadata>): Record<string, unknown> {
  const core = new Set(['type', 'project', 'gravity', 'links', 'tags', 'status', 'created']);
  return Object.fromEntries(Object.entries(meta).filter(([k]) => !core.has(k)));
}
