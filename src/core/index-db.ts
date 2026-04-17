/**
 * IndexDB
 *
 * SQLite cache with FTS5 full-text search.
 * This index is fully reconstructible from the files on disk.
 *
 * Guideline ref: §3 (.project/index.db), §7 (better-sqlite3 + FTS5).
 */

import Database from 'better-sqlite3';
import { join } from 'node:path';
import type { ProjectNode, NodeMetadata } from '../types/index.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS nodes (
    path        TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    project     TEXT NOT NULL DEFAULT '',
    gravity     REAL NOT NULL DEFAULT 0.5,
    status      TEXT NOT NULL DEFAULT 'draft',
    tags        TEXT NOT NULL DEFAULT '[]',
    links       TEXT NOT NULL DEFAULT '[]',
    created     TEXT NOT NULL DEFAULT '',
    metadata    TEXT NOT NULL DEFAULT '{}'
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
    path,
    tags,
    project,
    content=nodes,
    content_rowid=rowid
  );

  -- Triggers to keep FTS in sync
  CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
    INSERT INTO nodes_fts(rowid, path, tags, project)
    VALUES (new.rowid, new.path, new.tags, new.project);
  END;

  CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
    INSERT INTO nodes_fts(nodes_fts, rowid, path, tags, project)
    VALUES ('delete', old.rowid, old.path, old.tags, old.project);
  END;

  CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
    INSERT INTO nodes_fts(nodes_fts, rowid, path, tags, project)
    VALUES ('delete', old.rowid, old.path, old.tags, old.project);
    INSERT INTO nodes_fts(rowid, path, tags, project)
    VALUES (new.rowid, new.path, new.tags, new.project);
  END;
`;

// ---------------------------------------------------------------------------
// IndexDB
// ---------------------------------------------------------------------------

export class IndexDB {
  private db: Database.Database;

  constructor(vaultRoot: string, dbFileName: string = 'index.db') {
    const dbPath = join(vaultRoot, '.project', dbFileName);
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  /**
   * Upsert a node into the index.
   */
  upsert(node: ProjectNode): void {
    const stmt = this.db.prepare(`
      INSERT INTO nodes (path, type, project, gravity, status, tags, links, created, metadata)
      VALUES (@path, @type, @project, @gravity, @status, @tags, @links, @created, @metadata)
      ON CONFLICT(path) DO UPDATE SET
        type     = @type,
        project  = @project,
        gravity  = @gravity,
        status   = @status,
        tags     = @tags,
        links    = @links,
        created  = @created,
        metadata = @metadata
    `);

    const m = node.metadata;
    stmt.run({
      path: node.path,
      type: m.type,
      project: m.project ?? '',
      gravity: m.gravity,
      status: m.status,
      tags: JSON.stringify(m.tags),
      links: JSON.stringify(m.links),
      created: m.created,
      metadata: JSON.stringify(m),
    });
  }

  /**
   * Bulk upsert — wrapped in a transaction for performance.
   */
  upsertMany(nodes: ProjectNode[]): void {
    const tx = this.db.transaction((items: ProjectNode[]) => {
      for (const node of items) {
        this.upsert(node);
      }
    });
    tx(nodes);
  }

  /**
   * Remove a node by path.
   */
  remove(path: string): void {
    this.db.prepare('DELETE FROM nodes WHERE path = ?').run(path);
  }

  /**
   * Get a node by path.
   */
  get(path: string): ProjectNode | null {
    const row = this.db.prepare('SELECT * FROM nodes WHERE path = ?').get(path) as
      | Record<string, unknown>
      | undefined;

    if (!row) return null;
    return this.rowToNode(row);
  }

  /**
   * List all indexed nodes.
   */
  listAll(): ProjectNode[] {
    const rows = this.db.prepare('SELECT * FROM nodes ORDER BY path').all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToNode(r));
  }

  /**
   * Full-text search across path, tags, and project.
   */
  search(query: string): ProjectNode[] {
    const rows = this.db
      .prepare(
        `SELECT nodes.* FROM nodes_fts
         JOIN nodes ON nodes.rowid = nodes_fts.rowid
         WHERE nodes_fts MATCH ?
         ORDER BY rank`,
      )
      .all(query) as Record<string, unknown>[];

    return rows.map((r) => this.rowToNode(r));
  }

  /**
   * Get index stats.
   */
  stats(): { totalNodes: number; byType: Record<string, number> } {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM nodes').get() as {
      count: number;
    };
    const byType = this.db
      .prepare('SELECT type, COUNT(*) as count FROM nodes GROUP BY type')
      .all() as { type: string; count: number }[];

    return {
      totalNodes: total.count,
      byType: Object.fromEntries(byType.map((r) => [r.type, r.count])),
    };
  }

  /**
   * Drop all data and rebuild (called before a full re-index).
   */
  clear(): void {
    this.db.exec('DELETE FROM nodes');
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private rowToNode(row: Record<string, unknown>): ProjectNode {
    const metadata = JSON.parse(row.metadata as string) as NodeMetadata;
    return {
      path: row.path as string,
      metadata,
    };
  }
}
