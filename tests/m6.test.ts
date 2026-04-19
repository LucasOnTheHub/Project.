/**
 * M6 tests — Galaxie multi-projets
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MultiVaultReader } from '../src/core/multi-vault-reader.js';
import { VaultManager } from '../src/core/vault-manager.js';

async function makeVault(suffix: string, nodeCount = 2): Promise<{ dir: string; manager: VaultManager }> {
  const dir = join(tmpdir(), `m6-test-${suffix}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  const manager = new VaultManager(dir);
  await manager.createProject(`Project-${suffix}`);
  for (let i = 0; i < nodeCount; i++) {
    await manager.createNode(`docs/file-${i}.md`, 'doc', `# File ${i}\n\nContent.`);
  }
  return { dir, manager };
}

describe('MultiVaultReader — single vault', () => {
  let dir: string;
  let manager: VaultManager;

  beforeAll(async () => {
    ({ dir, manager } = await makeVault('single', 3));
  });
  afterAll(async () => {
    manager.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('returns a GalaxyGraph with 1 star', async () => {
    const mvr = new MultiVaultReader([dir]);
    const galaxy = await mvr.scanAll();
    expect(galaxy.stars).toHaveLength(1);
  });

  it('star offset is (0, 0, 0) for a single vault', async () => {
    const mvr = new MultiVaultReader([dir]);
    const galaxy = await mvr.scanAll();
    const { offset } = galaxy.stars[0];
    expect(offset.x).toBe(0);
    expect(offset.y).toBe(0);
    expect(offset.z).toBe(0);
  });
});

describe('MultiVaultReader — graceful degradation', () => {
  let dir: string;
  let manager: VaultManager;

  beforeAll(async () => {
    ({ dir, manager } = await makeVault('degrade', 1));
  });
  afterAll(async () => {
    manager.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('continues scanning valid vaults when one path is invalid', async () => {
    const invalidPath = join(tmpdir(), 'does-not-exist-m6-test');
    const mvr = new MultiVaultReader([invalidPath, dir]);
    const galaxy = await mvr.scanAll();
    expect(galaxy.stars).toHaveLength(1);
  });
});
