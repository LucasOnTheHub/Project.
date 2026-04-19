/**
 * Project. MCP Server — M5
 *
 * Scopes:
 *   read  — list_projects, get_node, search, get_graph
 *   write — create_node, update_node, link_nodes, set_gravity, create_task, toggle_task, create_reminder
 *   admin — create_project, delete_node, export_project, git_init, git_status, git_commit, git_log
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { join } from 'node:path';
import { VaultReader } from '../core/vault-reader.js';
import { VaultManager } from '../core/vault-manager.js';
import { ExportService } from '../core/exporter.js';
import { GitSync } from '../core/git-sync.js';
import type { NodeType, NodeStatus } from '../types/index.js';

type Scope = 'read' | 'write' | 'admin';

const SCOPE_RANK: Record<Scope, number> = { read: 0, write: 1, admin: 2 };

function hasScope(granted: Scope, required: Scope): boolean {
  return SCOPE_RANK[granted] >= SCOPE_RANK[required];
}

function requireScope(granted: Scope, required: Scope): void {
  if (!hasScope(granted, required)) {
    throw new Error(`Insufficient scope: need '${required}', have '${granted}'`);
  }
}

const NodeTypeLiteral = z.enum(['master', 'doc', 'code', 'asset', 'task', 'note', 'reminder']);
const NodeStatusLiteral = z.enum(['draft', 'active', 'done', 'archived']);

export function createMcpServer(
  vaultRoot: string,
  grantedScope: Scope = 'admin',
): McpServer {
  const manager = new VaultManager(vaultRoot);
  const reader = new VaultReader(vaultRoot);
  const exporter = new ExportService(vaultRoot);
  const git = new GitSync(vaultRoot);

  const server = new McpServer({
    name: 'project-mcp',
    version: '0.1.0',
  });

  // READ tools
  server.tool('list_projects', 'List all projects in the vault', {}, async () => {
    requireScope(grantedScope, 'read');
    const graph = await reader.scan();
    return { content: [{ type: 'text', text: JSON.stringify({ name: graph.name, master: graph.master?.path ?? null, nodeCount: graph.nodes.length, edgeCount: graph.edges.length }, null, 2) }] };
  });

  server.tool('get_graph', 'Return the full project graph', {}, async () => {
    requireScope(grantedScope, 'read');
    const graph = await reader.scan();
    return { content: [{ type: 'text', text: JSON.stringify(graph, null, 2) }] };
  });

  server.tool('get_node', 'Get a single node by path', { path: z.string() }, async ({ path }) => {
    requireScope(grantedScope, 'read');
    const node = manager.getNode(path);
    if (!node) return { content: [{ type: 'text', text: JSON.stringify({ error: `Node not found: ${path}` }) }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(node, null, 2) }] };
  });

  server.tool('search', 'Search nodes by query', { query: z.string(), project: z.string().optional() }, async ({ query }) => {
    requireScope(grantedScope, 'read');
    const graph = await reader.scan();
    manager.db.upsertMany(graph.nodes);
    const results = manager.search(query);
    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  });

  // WRITE tools
  server.tool('create_node', 'Create a new file node', {
    path: z.string(), type: NodeTypeLiteral, content: z.string().optional(),
    project: z.string().optional(), gravity: z.number().min(0).max(1).optional(),
    tags: z.array(z.string()).optional(), links: z.array(z.string()).optional(),
    status: NodeStatusLiteral.optional(),
  }, async ({ path, type, content, ...rest }) => {
    requireScope(grantedScope, 'write');
    const node = await manager.createNode(path, type as NodeType, content ?? '', rest);
    return { content: [{ type: 'text', text: JSON.stringify(node, null, 2) }] };
  });

  server.tool('update_node', 'Patch metadata/content of a node', {
    path: z.string(), content: z.string().optional(), type: NodeTypeLiteral.optional(),
    project: z.string().optional(), gravity: z.number().min(0).max(1).optional(),
    tags: z.array(z.string()).optional(), links: z.array(z.string()).optional(),
    status: NodeStatusLiteral.optional(),
  }, async ({ path, ...patch }) => {
    requireScope(grantedScope, 'write');
    const node = await manager.updateNode(path, patch);
    return { content: [{ type: 'text', text: JSON.stringify(node, null, 2) }] };
  });

  server.tool('link_nodes', 'Add a link between nodes', { from: z.string(), to: z.string() }, async ({ from, to }) => {
    requireScope(grantedScope, 'write');
    const node = await manager.linkNodes(from, to);
    return { content: [{ type: 'text', text: JSON.stringify(node, null, 2) }] };
  });

  server.tool('set_gravity', 'Set gravity of a node', { path: z.string(), value: z.number().min(0).max(1) }, async ({ path, value }) => {
    requireScope(grantedScope, 'write');
    const node = await manager.setGravity(path, value);
    return { content: [{ type: 'text', text: JSON.stringify(node, null, 2) }] };
  });

  server.tool('create_task', 'Create a task node', {
    project: z.string(), title: z.string(), parent: z.string().optional(),
    due: z.string().optional(), priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    assignee: z.string().optional(),
  }, async ({ project, title, ...opts }) => {
    requireScope(grantedScope, 'write');
    const node = await manager.createTask(project, title, opts);
    return { content: [{ type: 'text', text: JSON.stringify(node, null, 2) }] };
  });

  server.tool('toggle_task', 'Toggle a task done/active', { path: z.string() }, async ({ path }) => {
    requireScope(grantedScope, 'write');
    const graph = await reader.scan();
    manager.db.upsertMany(graph.nodes);
    const node = await manager.toggleTask(path);
    return { content: [{ type: 'text', text: JSON.stringify(node, null, 2) }] };
  });

  server.tool('create_reminder', 'Create a reminder node', {
    project: z.string(), title: z.string(), trigger: z.string(),
    channel: z.enum(['notif', 'mcp', 'email']).optional().default('notif'),
    recurring: z.boolean().optional().default(false),
  }, async ({ project, title, trigger, channel, recurring }) => {
    requireScope(grantedScope, 'write');
    const node = await manager.createReminder(project, title, trigger, channel, recurring);
    return { content: [{ type: 'text', text: JSON.stringify(node, null, 2) }] };
  });

  // ADMIN tools
  server.tool('create_project', 'Initialize a new vault', {
    name: z.string(), masterContent: z.string().optional(),
  }, async ({ name, masterContent }) => {
    requireScope(grantedScope, 'admin');
    const node = await manager.createProject(name, masterContent ?? '');
    return { content: [{ type: 'text', text: JSON.stringify(node, null, 2) }] };
  });

  server.tool('delete_node', 'Delete a node from disk and index', { path: z.string() }, async ({ path }) => {
    requireScope(grantedScope, 'admin');
    await manager.deleteNode(path);
    return { content: [{ type: 'text', text: JSON.stringify({ deleted: path }) }] };
  });

  server.tool('export_project', 'Export the vault', {
    format: z.enum(['zip', 'md-bundle', 'json-graph']).default('json-graph'),
    outDir: z.string().optional(),
  }, async ({ format, outDir }) => {
    requireScope(grantedScope, 'admin');
    if (format === 'json-graph') {
      const graph = await reader.scan();
      return { content: [{ type: 'text', text: JSON.stringify(graph, null, 2) }] };
    }
    const targetDir = outDir ?? vaultRoot;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    if (format === 'zip') {
      const outPath = join(targetDir, `export-${ts}.zip`);
      await exporter.exportZip(outPath);
      return { content: [{ type: 'text', text: JSON.stringify({ exported: outPath, format: 'zip' }) }] };
    }
    const outPath = join(targetDir, `export-${ts}.md`);
    await exporter.exportMdBundle(outPath);
    return { content: [{ type: 'text', text: JSON.stringify({ exported: outPath, format: 'md-bundle' }) }] };
  });

  server.tool('git_init', 'Init a git repo in the vault', {}, async () => {
    requireScope(grantedScope, 'admin');
    const msg = await git.init();
    return { content: [{ type: 'text', text: msg }] };
  });

  server.tool('git_status', 'Get vault git status', {}, async () => {
    requireScope(grantedScope, 'admin');
    const status = await git.status();
    return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
  });

  server.tool('git_commit', 'Stage all and commit', { message: z.string().optional() }, async ({ message }) => {
    requireScope(grantedScope, 'admin');
    const result = await git.commitAll(message);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.tool('git_log', 'Get recent commit history', { limit: z.number().int().min(1).max(100).optional().default(20) }, async ({ limit }) => {
    requireScope(grantedScope, 'admin');
    const log = await git.getLog(limit);
    return { content: [{ type: 'text', text: JSON.stringify(log, null, 2) }] };
  });

  return server;
}

export async function startServer(vaultRoot: string, scope: Scope = 'admin'): Promise<void> {
  const server = createMcpServer(vaultRoot, scope);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
