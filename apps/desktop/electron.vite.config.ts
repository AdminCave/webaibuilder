import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import type { Plugin } from 'vite';

/**
 * Produktions-CSP für den Renderer. Im Dev-Modus injiziert Vite/React-Refresh
 * Inline-Skripte, deshalb wird das Meta-Tag nur beim Build eingesetzt.
 * Google-Fonts-Hosts: das Design-System lädt Geist/Geist Mono per @import.
 * frame-src erlaubt den loopback-Preview-Server (packages/preview, M2); die
 * KI-Seite läuft im sandboxed <iframe> mit eigenem, token-geschütztem Origin.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  'frame-src http://127.0.0.1:*',
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/**
 * Workspace-Pakete sind reine TS-Quellen → in main/preload mitbundeln
 * (nicht externalisieren). Ihre echten npm-Abhängigkeiten bleiben dagegen
 * externalisiert (aus node_modules geladen, nicht in den Bundle gezogen).
 */
const WORKSPACE_PACKAGES = [
  '@webaibuilder/core',
  '@webaibuilder/agents',
  '@webaibuilder/preview',
  '@webaibuilder/versioning',
];

/** Transitive Laufzeit-Abhängigkeiten der gebundelten Workspace-Pakete. */
const WORKSPACE_RUNTIME_DEPS = [
  'chokidar',
  'mime',
  'ws',
  'simple-git',
  'isomorphic-git',
  'ai',
  'zod',
  '@ai-sdk/anthropic',
  '@ai-sdk/google',
  '@ai-sdk/openai',
  '@ai-sdk/xai',
  '@anthropic-ai/claude-agent-sdk',
];

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
    plugins: [
      externalizeDepsPlugin({
        exclude: WORKSPACE_PACKAGES,
        include: WORKSPACE_RUNTIME_DEPS,
      }),
    ],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })],
  },
  renderer: {
    plugins: [react(), cspPlugin()],
  },
});
