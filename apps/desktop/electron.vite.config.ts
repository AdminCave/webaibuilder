import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import type { Plugin } from 'vite';

/**
 * Production CSP for the renderer. In dev mode, Vite/React Refresh injects
 * inline scripts, so the meta tag is only applied on build.
 * Google Fonts hosts: the design system loads Geist/Geist Mono via @import.
 * frame-src allows the loopback preview server (packages/preview, M2); the AI
 * page runs in a sandboxed <iframe> with its own token-protected origin.
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
 * Workspace packages are pure TS sources → bundle them into main/preload
 * (don't externalize). Their actual npm dependencies, however, stay
 * externalized (loaded from node_modules, not pulled into the bundle).
 */
const WORKSPACE_PACKAGES = [
  '@webaibuilder/core',
  '@webaibuilder/agents',
  '@webaibuilder/preview',
  '@webaibuilder/versioning',
  '@webaibuilder/deploy',
];

/** Transitive runtime dependencies of the bundled workspace packages. */
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
  // Deploy-engine transports (packages/deploy) — native/CJS, don't bundle.
  'ssh2-sftp-client',
  'ssh2',
  'basic-ftp',
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
