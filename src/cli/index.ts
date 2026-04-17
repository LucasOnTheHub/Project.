#!/usr/bin/env node

/**
 * Project. CLI — Debug tool for M0
 *
 * Commands:
 *   scan    — full vault scan, print the graph
 *   stats   — index stats (node count by type)
 *   search  — full-text search
 *   node    — inspect a single node by path
 *   reindex — drop + rebuild the SQLite index
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { resolve } from 'node:path';
import { VaultReader } from '../core/vault-reader.js';
import { IndexDB } from '../core/index-db.js';

const program = new Command();

program
  .name('project')
  .description('Project. — file-based project manager CLI (M0 debug)')
  .version('0.1.0')
  .option('-d, --dir <path>', 'vault root directory', '.');

// ---------------------------------------------------------------------------
// scan
// ---------------------------------------------------------------------------

program
  .command('scan')
  .description('Scan the vault and display the project graph')
  .action(async () => {
    const vaultRoot = resolve(program.opts().dir as string);
    const reader = new VaultReader(vaultRoot);

    console.log(chalk.blue('Scanning vault:'), vaultRoot);

    const graph = await reader.scan();

    console.log(chalk.yellow(`\nProject: ${graph.name}`));
    console.log(chalk.green(`Master:  ${graph.master?.path ?? '(none)'}`));
    console.log(chalk.white(`Nodes:   ${graph.nodes.length}`));
    console.log(chalk.white(`Edges:   ${graph.edges.length}`));

    console.log(chalk.yellow('\n--- Nodes ---'));
    for (const node of graph.nodes) {
      const m = node.metadata;
      const grav = m.gravity.toFixed(1);
      console.log(
        `  ${typeIcon(m.type)} ${chalk.white(node.path)} ` +
          chalk.gray(`[${m.type}] g=${grav} status=${m.status}`) +
          (m.tags.length > 0 ? chalk.cyan(` #${m.tags.join(' #')}`) : ''),
      );
    }

    if (graph.edges.length > 0) {
      console.log(chalk.yellow('\n--- Edges ---'));
      for (const edge of graph.edges) {
        const arrow = edge.kind === 'link' ? '→' : '~';
        console.log(`  ${edge.from} ${chalk.gray(arrow)} ${edge.to} ${chalk.gray(`(${edge.kind})`)}`);
      }
    }
  });

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------

program
  .command('stats')
  .description('Show index statistics')
  .action(async () => {
    const vaultRoot = resolve(program.opts().dir as string);

    // Scan first to populate the index
    const reader = new VaultReader(vaultRoot);
    const graph = await reader.scan();
    const db = new IndexDB(vaultRoot);
    db.upsertMany(graph.nodes);

    const stats = db.stats();
    console.log(chalk.yellow('Index stats:'));
    console.log(`  Total nodes: ${chalk.white(String(stats.totalNodes))}`);
    for (const [type, count] of Object.entries(stats.byType)) {
      console.log(`  ${typeIcon(type)} ${type}: ${chalk.white(String(count))}`);
    }

    db.close();
  });

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

program
  .command('search <query>')
  .description('Full-text search across the index')
  .action(async (query: string) => {
    const vaultRoot = resolve(program.opts().dir as string);

    // Ensure index is up to date
    const reader = new VaultReader(vaultRoot);
    const graph = await reader.scan();
    const db = new IndexDB(vaultRoot);
    db.upsertMany(graph.nodes);

    const results = db.search(query);
    if (results.length === 0) {
      console.log(chalk.gray('No results.'));
    } else {
      console.log(chalk.yellow(`${results.length} result(s):`));
      for (const node of results) {
        console.log(`  ${typeIcon(node.metadata.type)} ${chalk.white(node.path)}`);
      }
    }

    db.close();
  });

// ---------------------------------------------------------------------------
// node
// ---------------------------------------------------------------------------

program
  .command('node <path>')
  .description('Inspect a single node by path')
  .action(async (path: string) => {
    const vaultRoot = resolve(program.opts().dir as string);
    const reader = new VaultReader(vaultRoot);
    await reader.scan();

    const node = reader.getNode(path);
    if (!node) {
      console.log(chalk.red(`Node not found: ${path}`));
      return;
    }

    console.log(chalk.yellow(`Node: ${node.path}`));
    console.log(JSON.stringify(node.metadata, null, 2));
  });

// ---------------------------------------------------------------------------
// reindex
// ---------------------------------------------------------------------------

program
  .command('reindex')
  .description('Drop and rebuild the SQLite index from disk')
  .action(async () => {
    const vaultRoot = resolve(program.opts().dir as string);

    console.log(chalk.blue('Reindexing vault...'));

    const reader = new VaultReader(vaultRoot);
    const graph = await reader.scan();
    const db = new IndexDB(vaultRoot);

    db.clear();
    db.upsertMany(graph.nodes);

    const stats = db.stats();
    console.log(chalk.green(`Done. Indexed ${stats.totalNodes} nodes.`));

    db.close();
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function typeIcon(type: string): string {
  const icons: Record<string, string> = {
    master: '⭐',
    doc: '📄',
    code: '💻',
    asset: '🖼️',
    task: '✅',
    note: '📝',
    reminder: '⏰',
  };
  return icons[type] ?? '📦';
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

program.parse();
