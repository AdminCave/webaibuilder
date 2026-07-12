/**
 * HTML-Injection (Dyad-`dyad-shim.js`-Muster, PLAN §4 Live-Preview):
 * In jede ausgelieferte HTML-Seite wird vor `</body>` ein Script injiziert mit
 *
 *  (a) wab-reload-client  — WebSocket-Client für Live-Reload; CSS-only-Änderungen
 *      tauschen `<link rel="stylesheet">` ohne Full-Reload.
 *  (b) wab-console-shim   — fängt `console.*`, Fehler (`error`-Event, deckt
 *      `window.onerror` ab) und `unhandledrejection`, serialisiert mit
 *      Größen-Caps, macht Stack-Pfade projekt-relativ und meldet alles per
 *      `postMessage` an den Parent-Frame UND über den WS an den Server.
 */

/** Pfad des WebSocket-Endpunkts (teilt sich den HTTP-Server). */
export const WS_PATH = '/__wab_ws';

/** Marker im injizierten Script — auch von den Tests geprüft. */
export const RELOAD_MARKER = 'wab-reload-client';
export const SHIM_MARKER = 'wab-console-shim';

/** Cap pro serialisiertem Console-Argument (~8 KB). */
export const ARG_CAP = 8 * 1024;
/** Cap pro Gesamt-Nachricht (~32 KB). */
export const TOTAL_CAP = 32 * 1024;

/** Baut das injizierte `<script>`-Element (Reload-Client + Console-Shim). */
export function buildPreviewClientScript(token: string): string {
  // Token/Konstanten werden als JSON-Literale eingebettet.
  const tokenLiteral = JSON.stringify(token);
  const wsPathLiteral = JSON.stringify(WS_PATH);

  return `<script data-wab-preview="1">
/* ${RELOAD_MARKER} + ${SHIM_MARKER} — von Web AI Builder injiziert (nur Dev-Preview) */
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

  /* Pfade projekt-relativ machen und das Token aus Texten tilgen. */
  function relativize(text) {
    var out = String(text);
    out = out.split(window.location.origin + '/').join('');
    out = out.split(window.location.origin).join('');
    out = out.split(TOKEN).join('***');
    return out;
  }

  function cap(text, limit) {
    text = String(text);
    return text.length > limit ? text.slice(0, limit) + ' … [gekürzt]' : text;
  }

  function serializeArg(value) {
    try {
      if (typeof value === 'string') return cap(value, ARG_CAP);
      if (value instanceof Error) {
        var head = (value.name || 'Error') + ': ' + value.message;
        return cap(relativize(value.stack ? head + '\\n' + value.stack : head), ARG_CAP);
      }
      if (typeof value === 'function') return '[function ' + (value.name || 'anonym') + ']';
      if (typeof value === 'undefined') return 'undefined';
      if (typeof value === 'bigint') return String(value) + 'n';
      var json = JSON.stringify(value);
      return cap(typeof json === 'string' ? json : String(value), ARG_CAP);
    } catch (_ignored) {
      try { return cap(String(value), ARG_CAP); } catch (_ignored2) { return '[nicht serialisierbar]'; }
    }
  }

  /* An Parent-Frame (postMessage) UND über den WS an den Server melden. */
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
    } catch (_ignored) { /* Parent nicht erreichbar — egal. */ }
  }

  /* ---- ${SHIM_MARKER} ---- */

  ['log', 'info', 'warn', 'error'].forEach(function (level) {
    console[level] = function () {
      original[level].apply(console, arguments);
      try {
        var parts = [];
        for (var i = 0; i < arguments.length; i += 1) parts.push(serializeArg(arguments[i]));
        send({ kind: 'console', level: level, text: cap(relativize(parts.join(' ')), TOTAL_CAP) });
      } catch (_ignored) { /* Shim darf die Seite nie brechen. */ }
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
        message: cap(relativize(event.message || 'Unbekannter Fehler'), ARG_CAP),
        stack: stack,
        source: source
      });
    } catch (_ignored) { /* nie werfen */ }
  });

  window.addEventListener('unhandledrejection', function (event) {
    try {
      var reason = event.reason;
      var isError = reason instanceof Error;
      var stack = isError && reason.stack ? cap(relativize(String(reason.stack)), ARG_CAP) : undefined;
      send({
        kind: 'error',
        message: cap('Unbehandelte Promise-Ablehnung: ' + relativize(isError ? reason.message : serializeArg(reason)), ARG_CAP),
        stack: stack
      });
    } catch (_ignored) { /* nie werfen */ }
  });

  /* ---- ${RELOAD_MARKER} ---- */

  function refreshStylesheets() {
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    var stamp = Date.now();
    for (var i = 0; i < links.length; i += 1) {
      var link = links[i];
      var href = link.getAttribute('href');
      if (!href) continue;
      /* Nur lokale Stylesheets anfassen — externe URLs unverändert lassen. */
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
    ws.addEventListener('error', function () { /* close-Handler übernimmt */ });
  }
  connect();
})();
</script>`;
}

/**
 * Injiziert das Preview-Script vor `</body>` (case-insensitiv, letzte Fundstelle);
 * ohne `</body>` wird es angehängt.
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

/** Minimalistische 404-Seite (dunkel, monospace — lose am AdminCave-Look). */
export function render404Page(pathname: string, injectedScript: string): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>404 — Nicht gefunden</title>
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
  <p>Diese Datei gibt es (noch) nicht.</p>
  <code>${escapeHtml(pathname)}</code>
  <p>Sobald du sie anlegst, lädt die Vorschau automatisch neu.</p>
</main>
${injectedScript}
</body>
</html>`;
}
