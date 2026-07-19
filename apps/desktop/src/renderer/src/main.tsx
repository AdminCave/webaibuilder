import React from 'react';
import { createRoot } from 'react-dom/client';

import '../styles/vendor/styles.css';
import './app.css';

import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

// Dark-mode-first: light only on an explicitly saved choice (data-theme="light").
if (localStorage.getItem('wab:theme') === 'light') {
  document.documentElement.dataset['theme'] = 'light';
}

// Report renderer errors to the local log (M5, PLAN §1/§6) — via the typed
// bridge, local only. Deliberately best effort: reporting must never crash itself.
window.addEventListener('error', (event) => {
  void window.wab.logs
    .report({
      kind: 'error',
      message: event.message,
      ...(event.error instanceof Error && event.error.stack !== undefined
        ? { stack: event.error.stack }
        : {}),
      source: event.filename,
      line: event.lineno,
      column: event.colno,
    })
    .catch(() => undefined);
});

window.addEventListener('unhandledrejection', (event) => {
  const reason: unknown = event.reason;
  const message = reason instanceof Error ? reason.message : String(reason);
  void window.wab.logs
    .report({
      kind: 'unhandledrejection',
      message,
      ...(reason instanceof Error && reason.stack !== undefined ? { stack: reason.stack } : {}),
    })
    .catch(() => undefined);
});

const rootElement = document.getElementById('root');
if (rootElement === null) throw new Error('#root missing in index.html');

createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary label="App">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
