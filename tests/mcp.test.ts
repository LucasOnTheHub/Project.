/**
 * MCP server integration tests — M1
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { VaultManager } from '../src/core/vault-manager.js';

describe('VaultManager — create_project', () => {
  let testDir: string;
  let manager: VaultManager;

  beforeAll(async () => {
    testDir = join(tmpdir(), `mcp-test-create-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    manager = new VaultManager(testDir);
  });

  afterAll(async () => {
    manager.close();
    await rm(testDir, { recursive: true, force: true });
  });

  it('should create the vault with a master node', async () => {
    const node = await manager.createProject('MyProject');
    expect(node.metadata.type).toBe('master');
    expect(node.metadata.project).toBe('MyProject');
    expect(node.path).toBe('guideline.md');
  });

  it('should be idempotent', async () => {
    const node = await manager.createProject('MyProject');
    expect(node.metadata.type).toBe('master');
  });
});

describe('VaultManager — create_node + get_node', () => {
  let testDir: string;
  let manager: VaultManager;

  beforeAll(async () => {
    testDir = join(tmpdir(), `mcp-test-node-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    manager = new VaultManager(testDir);
    await manager.createProject('TestVault');
  });

  afterAll(async () => {
    manager.close();
    await rm(testDir, { recursive: true, force: true });
  });

  it('should create a doc node and retrieve it', async () => {
    const node = await manager.createNode('docs/arch.md', 'doc', '# Architecture\n', {
      project: 'TestVault', gravity: 0.8, tags: ['arch'],
    });
    expect(node.path).toBe('docs/arch.md');
    expect(node.metadata.type).toBe('doc');
    expect(node.metadata.gravity).toBe(0.8);
    const retrieved = manager.getNode('docs/arch.md');
    expect(retrieved).not.toBeNull();
  });
});

describe('VaultManager — link_nodes', () => {
  let testDir: string;
  let manager: VaultManager;

  beforeAll(async () => {
    testDir = join(tmpdir(), `mcp-test-link-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    manager = new VaultManager(testDir);
    await manager.createProject('LinkVault');
    await manager.createNode('a.md', 'doc', '', { project: 'LinkVault' });
    await manager.createNode('b.md', 'doc', '', { project: 'LinkVault' });
  });

  afterAll(async () => {
    manager.close();
    await rm(testDir, { recursive: true, force: true });
  });

  it('should add a link from a.md to b.md', async () => {
    const node = await manager.linkNodes('a.md', 'b.md');
    expect(node.metadata.links).toContain('b.md');
  });

  it('should be idempotent', async () => {
    const node = await manager.linkNodes('a.md', 'b.md');
    const occurrences = node.metadata.links.filter((l) => l === 'b.md').length;
    expect(occurrences).toBe(1);
  });
});

describe('VaultManager — set_gravity', () => {
  let testDir: string;
  let manager: VaultManager;

  beforeAll(async () => {
    testDir = join(tmpdir(), `mcp-test-gravity-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    manager = new VaultManager(testDir);
    await manager.createProject('GravVault');
    await manager.createNode('star.md', 'doc', '', { project: 'GravVault', gravity: 0.5 });
  });

  afterAll(async () => {
    manager.close();
    await rm(testDir, { recursive: true, force: true });
  });

  it('should set gravity to 0.9', async () => {
    const node = await manager.setGravity('star.md', 0.9);
    expect(node.metadata.gravity).toBe(0.9);
  });

  it('should clamp gravity > 1 to 1.0', async () => {
    const node = await manager.setGravity('star.md', 1.5);
    expect(node.metadata.gravity).toBe(1.0);
  });

  it('should clamp gravity < 0 to 0.0', async () => {
    const node = await manager.setGravity('star.md', -0.3);
    expect(node.metadata.gravity).toBe(0.0);
  });
});

describe('VaultManager — create_task + toggle_task', () => {
  let testDir: string;
  let manager: VaultManager;

  beforeAll(async () => {
    testDir = join(tmpdir(), `mcp-test-task-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    manager = new VaultManager(testDir);
    await manager.createProject('TaskVault');
  });

  afterAll(async () => {
    manager.close();
    await rm(testDir, { recursive: true, force: true });
  });

  it('should create a task node', async () => {
    const node = await manager.createTask('TaskVault', 'Implement MCP server', { priority: 'high' });
    expect(node.metadata.type).toBe('task');
    expect((node.metadata as Record<string, unknown>).done).toBe(false);
  });

  it('should toggle a task to done', async () => {
    const created = await manager.createTask('TaskVault', 'Toggle me');
    const toggled = await manager.toggleTask(created.path);
    expect((toggled.metadata as Record<string, unknown>).done).toBe(true);
    expect(toggled.metadata.status).toBe('done');
  });
});

describe('VaultManager — delete_node', () => {
  let testDir: string;
  let manager: VaultManager;

  beforeAll(async () => {
    testDir = join(tmpdir(), `mcp-test-delete-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    manager = new VaultManager(testDir);
    await manager.createProject('DelVault');
  });

  afterAll(async () => {
    manager.close();
    await rm(testDir, { recursive: true, force: true });
  });

  it('should delete a node from disk and index', async () => {
    await manager.createNode('temp.md', 'note', 'bye\n', { project: 'DelVault' });
    expect(manager.getNode('temp.md')).not.toBeNull();
    await manager.deleteNode('temp.md');
    expect(manager.getNode('temp.md')).toBeNull();
  });
});

describe('MCP server — scope enforcement', () => {
  it('constructs read-only server without error', async () => {
    const { createMcpServer } = await import('../src/mcp/server.js');
    const tmpVault = join(tmpdir(), `scope-test-${Date.now()}`);
    await mkdir(tmpVault, { recursive: true });
    const server = createMcpServer(tmpVault, 'read');
    expect(server).toBeDefined();
    await rm(tmpVault, { recursive: true, force: true });
  });
});
