#!/usr/bin/env node

/**
 * Project. CLI — M1
 *
 * Commands:
 *   scan    — full vault scan, print the graph
 *   stats   — index stats (node count by type)
 *   search  — full-text search
 *   node    — inspect a single node by path
 *   reindex — drop + rebuild the SQLite index
 *   mcp     — start the MCP server (stdio transport)
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { resolve } from 'node:path';
import { VaultReader } from '../core/vault-reader.js';
import { IndexDB } from '../core/index-db.js';
import { startServer, startHttpServer } from '../mcp/index.js';

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
    console.log(chalk.green(`Master:  ${graph.master?.path ?? '(none)'}` ));
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
// ui — launch Electron graph view (M2)
// ---------------------------------------------------------------------------

program
  .command('ui')
  .description('Open the 2D graph view (Electron desktop app)')
  .action(async () => {
    const vaultRoot = resolve(program.opts().dir as string);

    // Dynamically import electron to avoid a hard dependency at module level
    // (allows the CLI to work even if Electron isn't installed on headless envs)
    let electronPath: string;
    try {
      const electronModule = await import('electron');
      electronPath = electronModule.default as unknown as string;
    } catch {
      console.error(chalk.red('Electron is not installed. Run: npm install --save-dev electron'));
      process.exit(1);
    }

    const { spawn } = await import('node:child_process');
    const { fileURLToPath } = await import('node:url');
    const { join: pathJoin, dirname } = await import('node:path');

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    // Point to the compiled main process (dist/electron/main.js after build)
    const mainEntry = pathJoin(__dirname, '../electron/main.js');

    console.log(chalk.blue('Launching Project. UI...'));
    console.log(chalk.gray(`  vault: ${vaultRoot}`));
    console.log(chalk.gray(`  main:  ${mainEntry}`));

    const child = spawn(electronPath, [mainEntry, '--dir', vaultRoot], {
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production' },
    });

    child.on('error', (err) => {
      console.error(chalk.red('Failed to launch Electron:'), err.message);
    });

    child.on('close', (code) => {
      if (code !== 0) process.exit(code ?? 1);
    });
  });

// ---------------------------------------------------------------------------
// mcp
// ---------------------------------------------------------------------------

program
  .command('mcp')
  .description('Start the MCP server (stdio by default; add --port to also expose HTTP/SSE)')
  .option('-s, --scope <scope>', 'granted scope: read | write | admin', 'admin')
  .option(
    '-p, --port <port>',
    'also start an HTTP/SSE server on this port (e.g. 3741). Omit for stdio-only.',
  )
  .option(
    '--host <host>',
    'hostname for the HTTP server (default: 127.0.0.1)',
    '127.0.0.1',
  )
  .option('--stateless', 'run HTTP server in stateless mode (no session management)', false)
  .option('--http-only', 'start HTTP/SSE only, skip stdio transport', false)
  .action(async (opts: {
    scope: string;
    port?: string;
    host: string;
    stateless: boolean;
    httpOnly: boolean;
  }) => {
    const vaultRoot = resolve(program.opts().dir as string);
    const scope = opts.scope as 'read' | 'write' | 'admin';
    const port = opts.port ? parseInt(opts.port, 10) : undefined;

    // stderr so it doesn't pollute the stdio MCP stream
    process.stderr.write(
      chalk.blue(`[project-mcp] Starting MCP server\n`) +
        chalk.gray(`  vault: ${vaultRoot}\n`) +
        chalk.gray(`  scope: ${scope}\n`),
    );

    // Start HTTP/SSE server if --port is given
    if (port !== undefined) {
      if (isNaN(port) || port < 1 || port > 65535) {
        process.stderr.write(chalk.red(`[project-mcp] Invalid port: ${opts.port}\n`));
        process.exit(1);
      }
      process.stderr.write(
        chalk.gray(`  http:  http://${opts.host}:${port}/mcp\n`) +
        chalk.gray(`  mode:  ${opts.stateless ? 'stateless' : 'stateful'}\n`),
      );
      // startHttpServer is non-blocking (returns an http.Server)
      await startHttpServer(vaultRoot, {
        port,
        host: opts.host,
        scope,
        stateless: opts.stateless,
      });
    }

    // Start stdio transport unless --http-only
    if (!opts.httpOnly) {
      await startServer(vaultRoot, scope);
    } else if (port === undefined) {
      process.stderr.write(chalk.red(`[project-mcp] --http-only requires --port\n`));
      process.exit(1);
    } else {
      // HTTP-only: keep process alive
      process.stderr.write(chalk.gray(`  stdio: disabled (--http-only)\n`));
      await new Promise(() => {}); // hang forever
    }
  });

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

program.parse();
