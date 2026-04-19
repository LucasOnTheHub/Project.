/**
 * M9 tests — Build & Distribution
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname ?? '', '..');

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf-8')) as Record<string, unknown>;
}

function readText(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf-8');
}

function exists(rel: string): boolean {
  return existsSync(join(ROOT, rel));
}

describe('M9 — package.json', () => {
  const pkg = readJson('package.json');
  const scripts = pkg['scripts'] as Record<string, string>;

  it('version is ≥ 0.9.0', () => {
    const ver = pkg['version'] as string;
    const [major, minor] = ver.split('.').map(Number);
    expect(major > 0 || (major === 0 && minor >= 9)).toBe(true);
  });

  it('main points to dist/electron/main.js', () => {
    expect(pkg['main']).toBe('dist/electron/main.js');
  });

  it('has dist:win script', () => {
    expect(scripts['dist:win']).toContain('electron-builder');
  });

  it('has dist:mac script', () => {
    expect(scripts['dist:mac']).toContain('electron-builder');
  });

  it('has dist:linux script', () => {
    expect(scripts['dist:linux']).toContain('electron-builder');
  });
});

describe('M9 — electron-builder.yml', () => {
  it('exists', () => { expect(exists('electron-builder.yml')).toBe(true); });
  it('contains appId', () => { expect(readText('electron-builder.yml')).toMatch(/appId:/); });
  it('contains productName: Project.', () => {
    expect(readText('electron-builder.yml')).toMatch(/productName:\s*Project\./);
  });
});

describe('M9 — GitHub Actions workflows', () => {
  it('ci.yml exists', () => { expect(exists('.github/workflows/ci.yml')).toBe(true); });
  it('release.yml exists', () => { expect(exists('.github/workflows/release.yml')).toBe(true); });
});
