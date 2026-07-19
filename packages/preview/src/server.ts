/**
 * Live preview server (PLAN §4): custom static server + chokidar +
 * WebSocket reload + HTML injection (reload client + console/error shim).
 *
 * Security (PLAN §4, Security — the preview renders AI-generated
 * HTML/JS, our largest attack surface):
 *  - binds exclusively to 127.0.0.1 (loopback-only, hard-enforced)
 *  - random port + random session token; every HTTP request and every
 *    WS connection needs the token (query `?wab=`, header `x-wab-token`
 *    or session cookie), compared in a timing-safe way
 *  - path containment incl. realpath check (no escaping the docroot,
 *    not even via symlinks)
 *
 * Electron-free — this package must never import `electron`.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import { watch } from 'chokidar';
import mime from 'mime';
import { WebSocketServer, WebSocket as WsWebSocket } from 'ws';

import { PreviewEventBus } from './events';
import { ARG_CAP, TOTAL_CAP, WS_PATH, buildPreviewClientScript, injectIntoHtml, render404Page } from './shim';
import type { PageConsoleLevel, PreviewServerHandle, PreviewServerOptions } from './types';

const LOOPBACK_HOST = '127.0.0.1';
const TOKEN_QUERY_PARAM = 'wab';
const TOKEN_HEADER = 'x-wab-token';
const TOKEN_COOKIE = 'wab_token';
/** Upper limit for incoming WS messages (the shim already caps client-side). */
const MAX_WS_PAYLOAD = 256 * 1024;
const DEFAULT_DEBOUNCE_MS = 100;

const CONSOLE_LEVELS: ReadonlySet<string> = new Set(['log', 'info', 'warn', 'error']);

/** Starts the preview server for a project (loopback-only, token-gated). */
export async function startPreviewServer(options: PreviewServerOptions): Promise<PreviewServerHandle> {
  const host = options.host ?? LOOPBACK_HOST;
  if (host !== LOOPBACK_HOST) {
    throw new Error(
      `For security reasons the preview server only binds to ${LOOPBACK_HOST} (loopback), not to "${host}".`,
    );
  }

  const siteDir = path.resolve(options.siteDir);
  const siteStat = await fs.stat(siteDir).catch(() => null);
  if (siteStat === null || !siteStat.isDirectory()) {
    throw new Error(`Preview: siteDir does not exist or is not a directory: ${siteDir}`);
  }
  // Symlink-safe comparison anchor for path containment.
  const siteRealDir = await fs.realpath(siteDir);

  const token = randomBytes(24).toString('base64url');
  const bus = new PreviewEventBus();
  if (options.onEvent) bus.on(options.onEvent);
  const injectedScript = buildPreviewClientScript(token);

  // ---- HTTP ----------------------------------------------------------------

  const server = createServer((req, res) => {
    void handleRequest(req, res).catch(() => {
      if (!res.headersSent) {
        respond(req, res, 500, 'text/plain; charset=utf-8', 'Internal error in the preview.');
      } else {
        res.destroy();
      }
    });
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    // The token must never leak via Referer to external resources of the AI page.
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      respond(req, res, 405, 'text/plain; charset=utf-8', 'Only GET and HEAD are allowed.');
      return;
    }

    if (!isAuthorized(req, token)) {
      respond(req, res, 403, 'text/plain; charset=utf-8', 'No access: the preview token is missing or invalid.');
      return;
    }
    // The first request comes with `?wab=<token>`; the cookie then authenticates
    // subresources (CSS/JS/images) that don't carry the query along.
    res.setHeader('Set-Cookie', `${TOKEN_COOKIE}=${token}; Path=/; SameSite=Strict; HttpOnly`);

    const url = new URL(req.url ?? '/', `http://${host}`);
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      respond(req, res, 400, 'text/plain; charset=utf-8', 'Invalid path.');
      return;
    }
    if (pathname.includes('\0')) {
      respond(req, res, 400, 'text/plain; charset=utf-8', 'Invalid path.');
      return;
    }

    // Path containment: never escape the docroot.
    let filePath = path.resolve(siteDir, `.${path.posix.normalize(`/${pathname}`)}`);
    if (filePath !== siteDir && !filePath.startsWith(siteDir + path.sep)) {
      respondNotFound(req, res, pathname);
      return;
    }

    let stat = await fs.stat(filePath).catch(() => null);

    if (stat?.isDirectory()) {
      if (!pathname.endsWith('/')) {
        // Redirect with a trailing slash so the page's relative links resolve.
        res.statusCode = 301;
        res.setHeader('Location', `${encodeURI(pathname)}/${url.search}`);
        res.end();
        return;
      }
      filePath = path.join(filePath, 'index.html');
      stat = await fs.stat(filePath).catch(() => null);
    }

    if (stat === null || !stat.isFile()) {
      respondNotFound(req, res, pathname);
      return;
    }

    // Symlink check: the real file must reside in the real docroot.
    const realPath = await fs.realpath(filePath).catch(() => null);
    if (realPath === null || (realPath !== siteRealDir && !realPath.startsWith(siteRealDir + path.sep))) {
      respondNotFound(req, res, pathname);
      return;
    }

    const type = mime.getType(filePath) ?? 'application/octet-stream';
    if (type === 'text/html') {
      const html = await fs.readFile(filePath, 'utf8');
      respond(req, res, 200, 'text/html; charset=utf-8', injectIntoHtml(html, injectedScript));
      return;
    }
    const body = await fs.readFile(filePath);
    const charset = /^text\/|^application\/(javascript|json|xml)/.test(type) ? '; charset=utf-8' : '';
    respond(req, res, 200, `${type}${charset}`, body);
  }

  function respondNotFound(req: IncomingMessage, res: ServerResponse, pathname: string): void {
    // The 404 page gets the reload client: once the AI creates the file,
    // the preview reloads on its own.
    respond(req, res, 404, 'text/html; charset=utf-8', render404Page(pathname, injectedScript));
  }

  // ---- WebSocket (shares the HTTP server) ------------------------------------

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD });

  server.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try {
      pathname = new URL(req.url ?? '/', `http://${host}`).pathname;
    } catch {
      /* stays empty → rejected */
    }
    if (pathname !== WS_PATH || !isAuthorized(req, token)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    ws.on('error', () => {
      /* let broken clients close silently */
    });
    ws.on('message', (data) => {
      const raw = Array.isArray(data) ? Buffer.concat(data).toString('utf8') : data.toString('utf8');
      handleShimMessage(raw);
    });
  });

  /** Messages from the injected shim → PreviewEvent (with server-side caps). */
  function handleShimMessage(raw: string): void {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null) return;
    const record = message as Record<string, unknown>;

    if (record['kind'] === 'console') {
      const level = record['level'];
      const text = record['text'];
      if (typeof level === 'string' && CONSOLE_LEVELS.has(level) && typeof text === 'string') {
        bus.emit({ type: 'page-console', level: level as PageConsoleLevel, text: capText(text, TOTAL_CAP) });
      }
      return;
    }
    if (record['kind'] === 'error') {
      const errorMessage = record['message'];
      if (typeof errorMessage !== 'string') return;
      const stack = typeof record['stack'] === 'string' ? capText(record['stack'], ARG_CAP) : undefined;
      const source = typeof record['source'] === 'string' ? capText(record['source'], ARG_CAP) : undefined;
      bus.emit({ type: 'page-error', message: capText(errorMessage, ARG_CAP), stack, source });
    }
  }

  function broadcast(payload: { kind: 'reload' } | { kind: 'css-update'; paths: string[] }): void {
    const text = JSON.stringify(payload);
    for (const client of wss.clients) {
      if (client.readyState === WsWebSocket.OPEN) client.send(text);
    }
  }

  // ---- Watcher (ground truth for file changes, PLAN §4) ---------------------

  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const pendingChanges = new Set<string>();
  let flushTimer: NodeJS.Timeout | undefined;

  const watcher = watch(siteDir, {
    ignoreInitial: true,
    // Hidden files/folders (.git & co.) are irrelevant for the preview.
    ignored: (watchedPath) => path.basename(watchedPath).startsWith('.'),
  });

  watcher.on('all', (eventName, changedPath) => {
    if (eventName !== 'add' && eventName !== 'change' && eventName !== 'unlink') return;
    pendingChanges.add(path.relative(siteDir, changedPath).split(path.sep).join('/'));
    if (flushTimer !== undefined) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushChanges, debounceMs);
  });

  function flushChanges(): void {
    flushTimer = undefined;
    if (pendingChanges.size === 0) return;
    const changedPaths = [...pendingChanges].sort();
    pendingChanges.clear();
    // CSS-only → hot-swap stylesheets instead of a full reload.
    const cssOnly = changedPaths.every((changed) => changed.toLowerCase().endsWith('.css'));
    broadcast(cssOnly ? { kind: 'css-update', paths: changedPaths } : { kind: 'reload' });
    bus.emit({ type: 'reload', changedPaths });
  }

  // ---- Start & Shutdown ------------------------------------------------------

  server.listen(0, host);
  try {
    await once(server, 'listening');
    await new Promise<void>((resolve, reject) => {
      watcher.once('ready', () => resolve());
      watcher.once('error', (error) => reject(error instanceof Error ? error : new Error(String(error))));
    });
  } catch (error) {
    await watcher.close().catch(() => undefined);
    server.close();
    throw error;
  }

  const port = (server.address() as AddressInfo).port;

  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      if (flushTimer !== undefined) clearTimeout(flushTimer);
      await watcher.close().catch(() => undefined);
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      bus.close();
    })();
    return closing;
  };

  return {
    url: `http://${LOOPBACK_HOST}:${port}/?${TOKEN_QUERY_PARAM}=${token}`,
    port,
    token,
    events: bus,
    close,
  };
}

// ---- Helpers -----------------------------------------------------------------

function respond(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  contentType: string,
  body: string | Buffer,
): void {
  const buffer = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', buffer.byteLength);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(buffer);
}

function capText(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)} … [truncated]` : text;
}

/** Read the token from query (`?wab=`), header (`x-wab-token`) or cookie. */
function extractToken(req: IncomingMessage): string | undefined {
  try {
    const url = new URL(req.url ?? '/', 'http://wab.invalid');
    const fromQuery = url.searchParams.get(TOKEN_QUERY_PARAM);
    if (fromQuery !== null && fromQuery !== '') return fromQuery;
  } catch {
    /* continue with header/cookie */
  }
  const fromHeader = req.headers[TOKEN_HEADER];
  if (typeof fromHeader === 'string' && fromHeader !== '') return fromHeader;
  const cookieHeader = req.headers.cookie;
  if (cookieHeader !== undefined) {
    for (const part of cookieHeader.split(';')) {
      const separator = part.indexOf('=');
      if (separator === -1) continue;
      if (part.slice(0, separator).trim() === TOKEN_COOKIE) {
        return part.slice(separator + 1).trim();
      }
    }
  }
  return undefined;
}

function isAuthorized(req: IncomingMessage, token: string): boolean {
  const provided = extractToken(req);
  if (provided === undefined) return false;
  const providedBuffer = Buffer.from(provided, 'utf8');
  const expectedBuffer = Buffer.from(token, 'utf8');
  return providedBuffer.byteLength === expectedBuffer.byteLength && timingSafeEqual(providedBuffer, expectedBuffer);
}
