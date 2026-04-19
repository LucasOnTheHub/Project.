/**
 * Project. — Electron Main Process (M9)
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VaultReader } from '../core/vault-reader.js';
import { VaultManager } from '../core/vault-manager.js';
import { GitSync } from '../core/git-sync.js';
import { MultiVaultReader } from '../core/multi-vault-reader.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function getVaultRoot(): string {
  const argIndex = process.argv.findIndex((a) => a === '--dir' || a === '-d');
  if (argIndex !== -1 && process.argv[argIndex + 1]) {
    return resolve(process.argv[argIndex + 1]);
  }
  if (process.env['PROJECT_VAULT_DIR']) {
    return resolve(process.env['PROJECT_VAULT_DIR']);
  }
  if (app.isPackaged) {
    return join(app.getPath('userData'), 'vault');
  }
  return process.cwd();
}

const vaultRoot = getVaultRoot();
const reader = new VaultReader(vaultRoot);
const manager = new VaultManager(vaultRoot);
const gitSync = new GitSync(vaultRoot);

function getGalaxyRoots(): string[] {
  const argIndex = process.argv.findIndex((a) => a === '--galaxy-dirs');
  if (argIndex !== -1 && process.argv[argIndex + 1]) {
    try {
      const parsed = JSON.parse(process.argv[argIndex + 1]) as string[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.map((p: string) => resolve(p));
    } catch { }
  }
  const envVal = process.env['PROJECT_GALAXY_DIRS'];
  if (envVal) {
    try {
      const parsed = JSON.parse(envVal) as string[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.map((p: string) => resolve(p));
    } catch { }
  }
  return [vaultRoot];
}

const galaxyRoots = getGalaxyRoots();
const multiReader = new MultiVaultReader(galaxyRoots);

ipcMain.handle('get-graph', async () => {
  const graph = await reader.scan();
  manager.db.upsertMany(graph.nodes);
  return graph;
});

ipcMain.handle('get-vault', () => vaultRoot);

ipcMain.handle('toggle-task', async (_event, path: string) => {
  const graph = await reader.scan();
  manager.db.upsertMany(graph.nodes);
  return manager.toggleTask(path);
});

ipcMain.handle('get-galaxy', async () => multiReader.scanAll());
ipcMain.handle('get-galaxy-roots', () => galaxyRoots);
ipcMain.handle('git-status', async () => gitSync.status());
ipcMain.handle('git-commit', async (_event, message?: string) => gitSync.commitAll(message));
ipcMain.handle('git-log', async (_event, limit = 20) => gitSync.getLog(limit));
ipcMain.handle('git-init', async () => gitSync.init());

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Project. — Graph View',
    backgroundColor: '#0d0d14',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isDev = process.env['NODE_ENV'] === 'development' || !app.isPackaged;
  if (isDev) {
    const devPort = process.env['VITE_DEV_PORT'] ?? '5173';
    win.loadURL(`http://localhost:${devPort}`);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(join(app.getAppPath(), 'dist-ui', 'index.html'));
  }

  return win;
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
