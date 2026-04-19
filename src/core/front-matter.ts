/**
 * FrontMatterParser
 *
 * Parses YAML front-matter from text files using js-yaml directly.
 * For binary/non-text files, reads the companion sidecar (.project.yml).
 *
 * Rule from guideline §4: any unknown field is preserved as-is.
 */

import yaml from 'js-yaml';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NodeMetadata, ParsedFile } from '../types/index.js';

const DEFAULT_METADATA: Omit<NodeMetadata, 'type' | 'project'> = {
  gravity: 0.5,
  links: [],
  tags: [],
  status: 'draft',
  created: new Date().toISOString().slice(0, 10),
};

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export class FrontMatterParser {
  constructor(
    private vaultRoot: string,
    private sidecarDirectory: string = '.project/sidecars',
  ) {}

  async parse(relativePath: string): Promise<ParsedFile> {
    const absolutePath = join(this.vaultRoot, relativePath);
    const raw = await readFile(absolutePath, 'utf-8').catch(() => null);

    if (raw !== null) {
      const match = FRONT_MATTER_RE.exec(raw);

      if (match) {
        const data = yaml.load(match[1]) as Record<string, unknown> | null;

        if (data && typeof data === 'object' && data.type) {
          return {
            path: relativePath,
            metadata: this.mergeDefaults(data),
            body: match[2],
            sidecar: false,
          };
        }
      }

      const sidecar = await this.tryReadSidecar(relativePath);
      if (sidecar) {
        return {
          path: relativePath,
          metadata: this.mergeDefaults(sidecar),
          body: raw,
          sidecar: true,
        };
      }

      return {
        path: relativePath,
        metadata: this.mergeDefaults({ type: 'note', project: '' }),
        body: raw,
        sidecar: false,
      };
    }

    const sidecar = await this.tryReadSidecar(relativePath);
    return {
      path: relativePath,
      metadata: sidecar
        ? this.mergeDefaults(sidecar)
        : this.mergeDefaults({ type: 'asset', project: '' }),
      body: '',
      sidecar: !!sidecar,
    };
  }

  stringify(metadata: NodeMetadata, body: string): string {
    const yamlStr = yaml.dump(metadata, { lineWidth: -1, noRefs: true });
    return `---\n${yamlStr}---\n${body}`;
  }

  private async tryReadSidecar(
    relativePath: string,
  ): Promise<Record<string, unknown> | null> {
    const sidecarPath = join(
      this.vaultRoot,
      this.sidecarDirectory,
      `${relativePath}.project.yml`,
    );

    try {
      const raw = await readFile(sidecarPath, 'utf-8');
      const data = yaml.load(raw) as Record<string, unknown> | null;
      return data && Object.keys(data).length > 0 ? data : null;
    } catch {
      return null;
    }
  }

  private mergeDefaults(data: Record<string, unknown>): NodeMetadata {
    return {
      ...DEFAULT_METADATA,
      ...data,
      links: Array.isArray(data.links) ? data.links : [],
      tags: Array.isArray(data.tags) ? data.tags : [],
    } as NodeMetadata;
  }
}
