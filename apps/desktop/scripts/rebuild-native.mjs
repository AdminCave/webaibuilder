// Baut das ABI-spezifische native Modul (better-sqlite3) für das gewünschte
// Runtime-Ziel um. Hintergrund: better-sqlite3 ist NAN-basiert (nicht N-API),
// die kompilierte .node-Datei muss zur ABI der Laufzeit passen.
//   - `node`     → für `pnpm -r test` (Vitest läuft unter System-Node)
//   - `electron` → für `pnpm dev` und Packaging (Electron bringt eine eigene ABI)
// @napi-rs/keyring ist dagegen N-API (ABI-stabil) und braucht KEINEN Rebuild.
//
// Aufruf: `node scripts/rebuild-native.mjs electron|node [--if-needed]`
// Plattformübergreifend (spawnt node-gyp über process.execPath, kein Shell-cd).
//
// `--if-needed` (dev-/test-Skripte): baut nur, wenn die vorhandene .node-Datei
// laut ABI-Marker nicht zum Ziel passt — der dev↔test-Toggle läuft damit
// automatisch, kostet aber nichts, wenn die ABI schon stimmt.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const mode = process.argv[2] === 'electron' ? 'electron' : 'node';
const ifNeeded = process.argv.includes('--if-needed');

const moduleDir = dirname(require.resolve('better-sqlite3/package.json'));
const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js');

const args = ['rebuild', '--release', `--arch=${process.arch}`];
let label = `node ${process.versions.node} (ABI ${process.versions.modules})`;
let target = `node-abi@${process.versions.modules}`;
if (mode === 'electron') {
  const electronVersion = require('electron/package.json').version;
  args.push(`--target=${electronVersion}`, '--dist-url=https://electronjs.org/headers');
  label = `Electron ${electronVersion}`;
  target = `electron@${electronVersion}`;
}

// Marker liegt in build/ — `node-gyp rebuild` räumt das Verzeichnis weg, ein
// veralteter Marker kann einen nötigen Neubau also nie verhindern.
const markerPath = join(moduleDir, 'build', '.wab-abi');
if (ifNeeded && existsSync(markerPath)) {
  try {
    if (readFileSync(markerPath, 'utf8').trim() === target) {
      console.log(`[rebuild-native] better-sqlite3 ist bereits auf ${label} gebaut — überspringe.`);
      process.exit(0);
    }
  } catch {
    /* Marker unlesbar → sicherheitshalber neu bauen. */
  }
}

console.log(`[rebuild-native] better-sqlite3 → ${label}\n  in ${moduleDir}`);
const result = spawnSync(process.execPath, [nodeGyp, ...args], {
  cwd: moduleDir,
  stdio: 'inherit',
});
if (result.status !== 0) {
  console.error(`[rebuild-native] Fehlgeschlagen (Exit ${result.status ?? 'unbekannt'}).`);
  process.exit(result.status ?? 1);
}
try {
  writeFileSync(markerPath, `${target}\n`);
} catch {
  /* Ohne Marker baut --if-needed beim nächsten Mal erneut — unkritisch. */
}
console.log(`[rebuild-native] Fertig. better-sqlite3 ist jetzt auf ${mode}-ABI gebaut.`);
