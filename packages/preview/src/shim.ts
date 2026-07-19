/**
 * HTML injection (Dyad `dyad-shim.js` pattern, PLAN §4 live preview):
 * A script is injected before `</body>` into every served HTML page with
 *
 *  (a) wab-reload-client  — WebSocket client for live reload; CSS-only changes
 *      swap `<link rel="stylesheet">` without a full reload.
 *  (b) wab-console-shim   — captures `console.*`, errors (`error` event, covers
 *      `window.onerror`) and `unhandledrejection`, serializes with
 *      size caps, makes stack paths project-relative and reports everything via
 *      `postMessage` to the parent frame AND over the WS to the server.
 */

/** Path of the WebSocket endpoint (shares the HTTP server). */
export const WS_PATH = '/__wab_ws';

/** Marker in the injected script — also checked by the tests. */
export const RELOAD_MARKER = 'wab-reload-client';
export const SHIM_MARKER = 'wab-console-shim';

/** Cap per serialized console argument (~8 KB). */
export const ARG_CAP = 8 * 1024;
/** Cap per total message (~32 KB). */
export const TOTAL_CAP = 32 * 1024;

/** Builds the injected `<script>` element (reload client + console shim). */
export function buildPreviewClientScript(token: string): string {
  // Token/constants are embedded as JSON literals.
  const tokenLiteral = JSON.stringify(token);
  const wsPathLiteral = JSON.stringify(WS_PATH);

  return `<script data-wab-preview="1">
/* ${RELOAD_MARKER} + ${SHIM_MARKER} — injected by Web AI Builder (dev preview only) */
(function () {
  'use strict';
  if (window.__WAB_PREVIEW__) return;
  window.__WAB_PREVIEW__ = true;

  var TOKEN = ${tokenLiteral};
  var WS_PATH = ${wsPathLiteral};
  var ARG_CAP = ${String(ARG_CAP)};
  var TOTAL_CAP = ${String(TOTAL_CAP)};
  var QUEUE_CAP = 200;

  var original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
  };

  var socket = null;
  var outbox = [];

  /* Make paths project-relative and strip the token from texts. */
  function relativize(text) {
    var out = String(text);
    out = out.split(window.location.origin + '/').join('');
    out = out.split(window.location.origin).join('');
    out = out.split(TOKEN).join('***');
    return out;
  }

  function cap(text, limit) {
    text = String(text);
    return text.length > limit ? text.slice(0, limit) + ' … [truncated]' : text;
  }

  function serializeArg(value) {
    try {
      if (typeof value === 'string') return cap(value, ARG_CAP);
      if (value instanceof Error) {
        var head = (value.name || 'Error') + ': ' + value.message;
        return cap(relativize(value.stack ? head + '\\n' + value.stack : head), ARG_CAP);
      }
      if (typeof value === 'function') return '[function ' + (value.name || 'anonymous') + ']';
      if (typeof value === 'undefined') return 'undefined';
      if (typeof value === 'bigint') return String(value) + 'n';
      var json = JSON.stringify(value);
      return cap(typeof json === 'string' ? json : String(value), ARG_CAP);
    } catch (_ignored) {
      try { return cap(String(value), ARG_CAP); } catch (_ignored2) { return '[not serializable]'; }
    }
  }

  /* Report to the parent frame (postMessage) AND over the WS to the server. */
  function send(payload) {
    var text;
    try { text = JSON.stringify(payload); } catch (_ignored) { return; }
    if (socket && socket.readyState === 1) {
      socket.send(text);
    } else if (outbox.length < QUEUE_CAP) {
      outbox.push(text);
    }
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(Object.assign({ source: 'wab-preview' }, payload), '*');
      }
    } catch (_ignored) { /* Parent not reachable — never mind. */ }
  }

  /* ---- ${SHIM_MARKER} ---- */

  ['log', 'info', 'warn', 'error'].forEach(function (level) {
    console[level] = function () {
      original[level].apply(console, arguments);
      try {
        var parts = [];
        for (var i = 0; i < arguments.length; i += 1) parts.push(serializeArg(arguments[i]));
        send({ kind: 'console', level: level, text: cap(relativize(parts.join(' ')), TOTAL_CAP) });
      } catch (_ignored) { /* The shim must never break the page. */ }
    };
  });

  window.addEventListener('error', function (event) {
    try {
      var err = event.error;
      var stack = err && err.stack ? cap(relativize(String(err.stack)), ARG_CAP) : undefined;
      var source = event.filename
        ? relativize(event.filename) + ':' + event.lineno + ':' + event.colno
        : undefined;
      send({
        kind: 'error',
        message: cap(relativize(event.message || 'Unknown error'), ARG_CAP),
        stack: stack,
        source: source
      });
    } catch (_ignored) { /* never throw */ }
  });

  window.addEventListener('unhandledrejection', function (event) {
    try {
      var reason = event.reason;
      var isError = reason instanceof Error;
      var stack = isError && reason.stack ? cap(relativize(String(reason.stack)), ARG_CAP) : undefined;
      send({
        kind: 'error',
        message: cap('Unhandled promise rejection: ' + relativize(isError ? reason.message : serializeArg(reason)), ARG_CAP),
        stack: stack
      });
    } catch (_ignored) { /* never throw */ }
  });

  /* ---- ${RELOAD_MARKER} ---- */

  function refreshStylesheets() {
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    var stamp = Date.now();
    for (var i = 0; i < links.length; i += 1) {
      var link = links[i];
      var href = link.getAttribute('href');
      if (!href) continue;
      /* Only touch local stylesheets — leave external URLs unchanged. */
      if (/^(https?:)?\\/\\//.test(href) && href.indexOf(window.location.origin) !== 0) continue;
      link.setAttribute('href', href.split('?')[0] + '?wab_t=' + stamp);
    }
  }

  var reconnectDelay = 500;
  function connect() {
    var ws;
    try {
      var scheme = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
      ws = new WebSocket(scheme + window.location.host + WS_PATH + '?wab=' + encodeURIComponent(TOKEN));
    } catch (_ignored) {
      return;
    }
    socket = ws;
    ws.addEventListener('open', function () {
      reconnectDelay = 500;
      while (outbox.length > 0 && ws.readyState === 1) ws.send(outbox.shift());
    });
    ws.addEventListener('message', function (event) {
      var msg;
      try { msg = JSON.parse(String(event.data)); } catch (_ignored) { return; }
      if (!msg) return;
      if (msg.kind === 'reload') { window.location.reload(); return; }
      if (msg.kind === 'css-update') refreshStylesheets();
    });
    ws.addEventListener('close', function () {
      socket = null;
      reconnectDelay = Math.min(reconnectDelay * 2, 5000);
      setTimeout(connect, reconnectDelay);
    });
    ws.addEventListener('error', function () { /* close handler takes over */ });
  }
  connect();
})();
</script>`;
}

/**
 * Injects the preview script before `</body>` (case-insensitive, last occurrence);
 * without a `</body>` it is appended.
 */
export function injectIntoHtml(html: string, script: string): string {
  const index = html.toLowerCase().lastIndexOf('</body>');
  if (index === -1) return html + script;
  return html.slice(0, index) + script + html.slice(index);
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Minimalist 404 page (dark, monospace — loosely following the AdminCave look). */
export function render404Page(pathname: string, injectedScript: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>404 — Not found</title>
<style>
  html, body { height: 100%; }
  body {
    margin: 0;
    background: #000;
    color: #e5e5e5;
    font-family: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    display: grid;
    place-items: center;
  }
  main { text-align: center; padding: 24px; }
  h1 { font-size: 64px; font-weight: 600; margin: 0 0 8px; letter-spacing: -0.03em; }
  p { margin: 4px 0; font-size: 14px; color: #a3a3a3; }
  code {
    display: inline-block;
    margin-top: 12px;
    padding: 6px 12px;
    border: 1px solid #262626;
    border-radius: 999px;
    color: #e5e5e5;
    font-size: 13px;
    word-break: break-all;
  }
</style>
</head>
<body>
<main>
  <h1>404</h1>
  <p>This file does not exist (yet).</p>
  <code>${escapeHtml(pathname)}</code>
  <p>As soon as you create it, the preview reloads automatically.</p>
</main>
${injectedScript}
</body>
</html>`;
}
