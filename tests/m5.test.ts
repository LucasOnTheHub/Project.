/**
 * M5 tests — Export & Git sync
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, rm, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ExportService } from '../src/core/exporter.js';
import { GitSync } from '../src/core/git-sync.js';
import { VaultManager } from '../src/core/vault-manager.js';

async function makeVault(suffix: string): Promise<{ dir: string; manager: VaultManager }> {
  const dir = join(tmpdir(), `m5-test-${suffix}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  const manager = new VaultManager(dir);
  await manager.createProject('TestProject');
  await manager.createNode('docs/intro.md', 'doc', '# Introduction\n\nHello world.');
  await manager.createNode('docs/notes.md', 'note', '# Notes\n\nSome notes.');
  return { dir, manager };
}

describe('ExportService — exportZip', () => {
  let dir: string;
  let manager: VaultManager;
  let exporter: ExportService;

  beforeAll(async () => {
    ({ dir, manager } = await makeVault('zip'));
    exporter = new ExportService(dir);
  });

  afterAll(async () => {
    manager.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('creates a .zip file on disk', async () => {
    const outPath = join(dir, 'test-export.zip');
    const result = await exporter.exportZip(outPath);
    expect(result).toBe(outPath);
    const info = await stat(outPath);
    expect(info.size).toBeGreaterThan(100);
  });

  it('returns the output path', async () => {
    const outPath = join(dir, 'test-export2.zip');
    const result = await exporter.exportZip(outPath);
    expect(result).toBe(outPath);
  });
});

describe('GitSync — non-repo', () => {
  let dir: string;
  let git: GitSync;

  beforeAll(async () => {
    dir = join(tmpdir(), `m5-git-empty-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    git = new GitSync(dir);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('isRepo returns false for a plain directory', async () => {
    const result = await git.isRepo();
    expect(result).toBe(false);
  });

  it('status returns isRepo: false without throwing', async () => {
    const s = await git.status();
    expect(s.isRepo).toBe(false);
  });

  it('commitAll throws for non-repo', async () => {
    await expect(git.commitAll()).rejects.toThrow('Not a git repository');
  });
});
