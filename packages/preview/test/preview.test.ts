import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  RELOAD_MARKER,
  SHIM_MARKER,
  WS_PATH,
  startPreviewServer,
  type PreviewEvent,
  type PreviewServerHandle,
} from '../src/index';

const INDEX_HTML = `<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><title>Test</title><link rel="stylesheet" href="style.css"></head>
<body><h1>Hallo</h1></body>
</html>`;

const STYLE_CSS = 'h1 { color: rebeccapurple; }';

function waitForEvent(
  handle: PreviewServerHandle,
  predicate: (event: PreviewEvent) => boolean,
  timeoutMs = 5000,
): Promise<PreviewEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`Timeout: no matching PreviewEvent after ${timeoutMs}ms`));
    }, timeoutMs);
    const off = handle.events.on((event) => {
      if (predicate(event)) {
        clearTimeout(timer);
        off();
        resolve(event);
      }
    });
  });
}

describe('startPreviewServer', () => {
  let siteDir: string;
  let handle: PreviewServerHandle;

  beforeEach(async () => {
    siteDir = await mkdtemp(join(tmpdir(), 'wab-preview-'));
    await writeFile(join(siteDir, 'index.html'), INDEX_HTML, 'utf8');
    await writeFile(join(siteDir, 'style.css'), STYLE_CSS, 'utf8');
    handle = await startPreviewServer({ siteDir });
  });

  afterEach(async () => {
    await handle.close();
    await rm(siteDir, { recursive: true, force: true });
  });

  it('binds loopback-only and returns a token URL', () => {
    const url = new URL(handle.url);
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.port).toBe(String(handle.port));
    expect(url.searchParams.get('wab')).toBe(handle.token);
    expect(handle.token.length).toBeGreaterThanOrEqual(24);
  });

  it('rejects requests without or with a wrong token', async () => {
    const noToken = await fetch(`http://127.0.0.1:${handle.port}/`);
    expect(noToken.status).toBe(403);

    const wrongToken = await fetch(`http://127.0.0.1:${handle.port}/?wab=falsches-token`);
    expect(wrongToken.status).toBe(403);
  });

  it('serves authorized injected HTML with reload client and console shim', async () => {
    const response = await fetch(handle.url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');

    const html = await response.text();
    expect(html).toContain(RELOAD_MARKER);
    expect(html).toContain(SHIM_MARKER);
    // Injection sits before </body>.
    expect(html.indexOf(RELOAD_MARKER)).toBeLessThan(html.toLowerCase().lastIndexOf('</body>'));

    // Subresource via header token, correct MIME type, no injection.
    const css = await fetch(`http://127.0.0.1:${handle.port}/style.css`, {
      headers: { 'x-wab-token': handle.token },
    });
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toContain('text/css');
    expect(await css.text()).toBe(STYLE_CSS);
  });

  it('serves a 404 page for missing files', async () => {
    const response = await fetch(`http://127.0.0.1:${handle.port}/gibts-nicht.html?wab=${handle.token}`);
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain('404');
    expect(html).toContain('As soon as you create it');
    expect(html).toContain(RELOAD_MARKER);
  });

  it('emits a reload PreviewEvent when a file is written', async () => {
    const eventPromise = waitForEvent(handle, (event) => event.type === 'reload');
    await writeFile(join(siteDir, 'neu.html'), '<html><body>Neu</body></html>', 'utf8');

    const event = await eventPromise;
    expect(event.type).toBe('reload');
    if (event.type === 'reload') {
      expect(event.changedPaths).toContain('neu.html');
    }
  });

  it('authenticates WS with token, pushes reload/css-update and re-emits shim messages', async () => {
    const { WebSocket } = await import('ws');

    // Without token: upgrade is rejected.
    const rejected = new WebSocket(`ws://127.0.0.1:${handle.port}${WS_PATH}`);
    const status = await new Promise<number | undefined>((resolve) => {
      rejected.once('unexpected-response', (_req, res) => resolve(res.statusCode));
      rejected.once('error', () => resolve(undefined));
      rejected.once('open', () => resolve(-1));
    });
    expect(status).toBe(403);

    // With token: connected.
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}${WS_PATH}?wab=${handle.token}`);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    try {
      const messages: Array<Record<string, unknown>> = [];
      const nextMessage = (predicate: (msg: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> =>
        new Promise((resolve, reject) => {
          const existing = messages.find(predicate);
          if (existing) {
            resolve(existing);
            return;
          }
          const timer = setTimeout(() => reject(new Error('Timeout: no WS message')), 5000);
          const onMessage = (data: unknown): void => {
            const msg = JSON.parse(String(data)) as Record<string, unknown>;
            messages.push(msg);
            if (predicate(msg)) {
              clearTimeout(timer);
              ws.off('message', onMessage);
              resolve(msg);
            }
          };
          ws.on('message', onMessage);
        });

      // HTML change → full-reload push.
      const reloadMsg = nextMessage((msg) => msg['kind'] === 'reload');
      await writeFile(join(siteDir, 'index.html'), INDEX_HTML.replace('Hallo', 'Moin'), 'utf8');
      expect((await reloadMsg)['kind']).toBe('reload');

      // CSS-only change → css-update instead of full reload.
      const cssMsg = nextMessage((msg) => msg['kind'] === 'css-update');
      await writeFile(join(siteDir, 'style.css'), 'h1 { color: teal; }', 'utf8');
      const cssUpdate = await cssMsg;
      expect(cssUpdate['paths']).toContain('style.css');

      // Shim messages over the WS → PreviewEvent page-console / page-error.
      const consoleEvent = waitForEvent(handle, (event) => event.type === 'page-console');
      ws.send(JSON.stringify({ kind: 'console', level: 'warn', text: 'Hallo Konsole' }));
      const emitted = await consoleEvent;
      expect(emitted).toEqual({ type: 'page-console', level: 'warn', text: 'Hallo Konsole' });

      const errorEvent = waitForEvent(handle, (event) => event.type === 'page-error');
      ws.send(JSON.stringify({ kind: 'error', message: 'Kaputt', stack: 'main.js:1:1', source: 'main.js:1:1' }));
      const emittedError = await errorEvent;
      expect(emittedError).toEqual({
        type: 'page-error',
        message: 'Kaputt',
        stack: 'main.js:1:1',
        source: 'main.js:1:1',
      });
    } finally {
      ws.close();
    }
  });

  it('blocks path traversal out of the docroot', async () => {
    const response = await fetch(`http://127.0.0.1:${handle.port}/..%2F..%2Fetc%2Fpasswd?wab=${handle.token}`, {});
    expect([400, 403, 404]).toContain(response.status);
    if (response.status === 404) {
      expect(await response.text()).not.toContain('root:');
    }
  });

  it('frees the port again after close()', async () => {
    const { port } = handle;
    await handle.close();
    // Closing twice is ok (idempotent).
    await handle.close();

    // The port can be bound again …
    const probe: Server = createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(port, '127.0.0.1', () => resolve());
    });
    await new Promise<void>((resolve) => {
      probe.close(() => resolve());
    });

    // … and the event stream ends (async iterator runs empty).
    const iterator = handle.events[Symbol.asyncIterator]();
    const result = await iterator.next();
    expect(result.done).toBe(true);
  });
});
