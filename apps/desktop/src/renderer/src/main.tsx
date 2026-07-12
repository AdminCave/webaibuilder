import React from 'react';
import { createRoot } from 'react-dom/client';

import '../styles/vendor/styles.css';
import './app.css';

import { App } from './App';

// Dark-mode-first: Light nur bei explizit gespeicherter Wahl (data-theme="light").
if (localStorage.getItem('wab:theme') === 'light') {
  document.documentElement.dataset['theme'] = 'light';
}

const rootElement = document.getElementById('root');
if (rootElement === null) throw new Error('#root fehlt in index.html');

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
