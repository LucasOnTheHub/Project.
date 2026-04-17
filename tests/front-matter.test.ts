import { describe, it, expect, beforeAll } from 'vitest';
import { FrontMatterParser } from '../src/core/front-matter.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('FrontMatterParser', () => {
  let testDir: string;
  let parser: FrontMatterParser;

  beforeAll(async () => {
    testDir = join(tmpdir(), `project-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    await mkdir(join(testDir, '.project', 'sidecars'), { recursive: true });
    parser = new FrontMatterParser(testDir);

    // Create a test file with front-matter
    await writeFile(
      join(testDir, 'test-doc.md'),
      `---
type: doc
project: TestProject
gravity: 0.8
tags: [test, unit]
links: []
status: active
created: 2026-04-12
---

# Test Document

This is a test.
`,
    );

    // Create a file without front-matter
    await writeFile(join(testDir, 'plain.txt'), 'Just plain text, no metadata.');
  });

  it('should parse a file with valid front-matter', async () => {
    const result = await parser.parse('test-doc.md');

    expect(result.metadata.type).toBe('doc');
    expect(result.metadata.project).toBe('TestProject');
    expect(result.metadata.gravity).toBe(0.8);
    expect(result.metadata.tags).toEqual(['test', 'unit']);
    expect(result.metadata.status).toBe('active');
    expect(result.sidecar).toBe(false);
    expect(result.body).toContain('# Test Document');
  });

  it('should fall back to defaults for a file without front-matter', async () => {
    const result = await parser.parse('plain.txt');

    expect(result.metadata.type).toBe('note');
    expect(result.metadata.gravity).toBe(0.5);
    expect(result.metadata.tags).toEqual([]);
    expect(result.sidecar).toBe(false);
    expect(result.body).toBe('Just plain text, no metadata.');
  });

  it('should stringify metadata back to front-matter', () => {
    const metadata = {
      type: 'doc' as const,
      project: 'Test',
      gravity: 0.7,
      links: [],
      tags: ['a'],
      status: 'draft' as const,
      created: '2026-04-12',
    };

    const output = parser.stringify(metadata, '# Hello');
    expect(output).toContain('type: doc');
    expect(output).toContain('# Hello');
  });
});
