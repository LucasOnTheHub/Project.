/**
 * Project. MCP — HTTP/SSE transport (M7)
 */

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server.js';

export interface HttpServerOptions {
  port?: number;
  host?: string;
  scope?: 'read' | 'write' | 'admin';
  stateless?: boolean;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  createdAt: number;
}

const MAX_SESSIONS = 100;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

export async function startHttpServer(
  vaultRoot: string,
  options: HttpServerOptions = {},
): Promise<http.Server> {
  const {
    port = 3741,
    host = '127.0.0.1',
    scope = 'read',
    stateless = false,
  } = options;

  const apiKey = process.env['MCP_API_KEY'];

  const sessions = new Map<string, Session>();

  // Periodically evict sessions older than SESSION_TTL_MS
  const sweepInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.createdAt > SESSION_TTL_MS) {
        session.transport.close().catch(() => {});
        sessions.delete(id);
      }
    }
  }, 60_000);
  sweepInterval.unref();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname === '/health') {
      const body = JSON.stringify({
        status: 'ok',
        transport: 'streamable-http',
        stateless,
        sessions: stateless ? null : sessions.size,
        ts: new Date().toISOString(),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }

    // API-key authentication (only required when MCP_API_KEY is set)
    if (apiKey) {
      const authHeader = req.headers['authorization'];
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
      if (token !== apiKey) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
    }

    if (url.pathname === '/mcp') {
      if (req.method === 'DELETE') {
        if (stateless) {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session management not available in stateless mode' }));
          return;
        }
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (sessionId && sessions.has(sessionId)) {
          const session = sessions.get(sessionId)!;
          await session.transport.close();
          sessions.delete(sessionId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ closed: sessionId }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session not found' }));
        }
        return;
      }

      if (req.method === 'POST' || req.method === 'GET') {
        if (stateless) {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
          });
          const mcpServer = createMcpServer(vaultRoot, scope);
          await mcpServer.connect(transport);
          await transport.handleRequest(req, res);
          res.on('finish', () => {
            transport.close().catch(() => {});
          });
          return;
        }

        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        if (sessionId && sessions.has(sessionId)) {
          const session = sessions.get(sessionId)!;
          await session.transport.handleRequest(req, res);
          return;
        }

        if (req.method !== 'POST') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'New sessions must be initialized via POST' }));
          return;
        }

        if (sessions.size >= MAX_SESSIONS) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Too many active sessions' }));
          return;
        }

        const newSessionId = randomUUID();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => newSessionId,
        });

        const mcpServer = createMcpServer(vaultRoot, scope);
        await mcpServer.connect(transport);

        sessions.set(newSessionId, { transport, createdAt: Date.now() });

        transport.onclose = () => {
          sessions.delete(newSessionId);
        };

        await transport.handleRequest(req, res);
        return;
      }

      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Method ${req.method} not allowed on /mcp` }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found', path: url.pathname }));
  });

  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, resolve);
  });

  const mode = stateless ? 'stateless' : 'stateful';
  const authNote = apiKey ? ' (auth: bearer token)' : ' (auth: none — set MCP_API_KEY to enable)';
  process.stderr.write(
    `[project-mcp] HTTP/SSE server listening on http://${host}:${port}/mcp (${mode})${authNote}\n` +
    `[project-mcp] Health: http://${host}:${port}/health\n`,
  );

  return server;
}
