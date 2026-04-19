/**
 * M7 tests — HTTP/SSE MCP transport
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startHttpServer } from '../src/mcp/http-server.js';
import { VaultManager } from '../src/core/vault-manager.js';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as { port: number };
      srv.close(() => resolve(addr.port));
    });
    srv.on('error', reject);
  });
}

async function httpGet(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.setTimeout(500, () => req.destroy());
  });
}

async function httpPost(url: string, payload: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const urlObj = new URL(url);
    const opts: http.RequestOptions = {
      hostname: urlObj.hostname, port: Number(urlObj.port), path: urlObj.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'Content-Length': Buffer.byteLength(data), ...headers },
    };
    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function httpDelete(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const opts: http.RequestOptions = {
      hostname: urlObj.hostname, port: Number(urlObj.port), path: urlObj.pathname, method: 'DELETE', headers,
    };
    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

let vaultDir: string;
let manager: VaultManager;

beforeAll(async () => {
  vaultDir = join(tmpdir(), `m7-test-${Date.now()}`);
  await mkdir(vaultDir, { recursive: true });
  manager = new VaultManager(vaultDir);
  await manager.createProject('M7-TestProject');
});

afterAll(async () => {
  manager.close();
  await rm(vaultDir, { recursive: true, force: true });
});

describe('HTTP/SSE server — /health', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    port = await freePort();
    server = await startHttpServer(vaultDir, { port, stateless: true });
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('returns 200 on GET /health', async () => {
    const { status } = await httpGet(`http://127.0.0.1:${port}/health`);
    expect(status).toBe(200);
  });

  it('returns valid JSON with status=ok', async () => {
    const { body } = await httpGet(`http://127.0.0.1:${port}/health`);
    const json = JSON.parse(body);
    expect(json.status).toBe('ok');
    expect(json.transport).toBe('streamable-http');
  });

  it('returns 404 on unknown path', async () => {
    const { status } = await httpGet(`http://127.0.0.1:${port}/unknown`);
    expect(status).toBe(404);
  });
});

describe('HTTP/SSE server — stateful mode', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    port = await freePort();
    server = await startHttpServer(vaultDir, { port, stateless: false });
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('POST /mcp initialize returns 200 and sets mcp-session-id', async () => {
    const initRequest = {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test-client', version: '0.0.1' } },
    };
    const { status, headers } = await httpPost(`http://127.0.0.1:${port}/mcp`, initRequest);
    expect(status).toBe(200);
    expect(headers['mcp-session-id']).toBeTruthy();
  });

  it('DELETE /mcp with unknown session returns 404', async () => {
    const { status } = await httpDelete(`http://127.0.0.1:${port}/mcp`, { 'mcp-session-id': 'non-existent' });
    expect(status).toBe(404);
  });
});

describe('HTTP/SSE server — stateless mode', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    port = await freePort();
    server = await startHttpServer(vaultDir, { port, stateless: true });
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('POST /mcp initialize returns 200', async () => {
    const initRequest = {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test-client', version: '0.0.1' } },
    };
    const { status } = await httpPost(`http://127.0.0.1:${port}/mcp`, initRequest);
    expect(status).toBe(200);
  });

  it('DELETE /mcp returns 405 in stateless mode', async () => {
    const { status } = await httpDelete(`http://127.0.0.1:${port}/mcp`);
    expect(status).toBe(405);
  });
});
