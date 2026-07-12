import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import type { Plugin } from 'vite';

/**
 * Produktions-CSP für den Renderer. Im Dev-Modus injiziert Vite/React-Refresh
 * Inline-Skripte, deshalb wird das Meta-Tag nur beim Build eingesetzt.
 * Google-Fonts-Hosts: das Design-System lädt Geist/Geist Mono per @import.
 * TODO(M1): frame-src um http://127.0.0.1:* für den Preview-Server erweitern.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'wab-csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export default defineConfig({
  main: {
    // Workspace-Pakete sind reine TS-Quellen -> mitbundeln, nicht externalisieren.
    plugins: [externalizeDepsPlugin({ exclude: ['@webaibuilder/core'] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@webaibuilder/core'] })],
  },
  renderer: {
    plugins: [react(), cspPlugin()],
  },
});
