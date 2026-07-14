// Baut das ABI-spezifische native Modul (better-sqlite3) für das gewünschte
// Runtime-Ziel um. Hintergrund: better-sqlite3 ist NAN-basiert (nicht N-API),
// die kompilierte .node-Datei muss zur ABI der Laufzeit passen.
//   - `node`     → für `pnpm -r test` (Vitest läuft unter System-Node)
//   - `electron` → für `pnpm dev` und Packaging (Electron bringt eine eigene ABI)
// @napi-rs/keyring ist dagegen N-API (ABI-stabil) und braucht KEINEN Rebuild.
//
// Aufruf: `node scripts/rebuild-native.mjs electron|node`
// Plattformübergreifend (spawnt node-gyp über process.execPath, kein Shell-cd).

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);
const mode = process.argv[2] === 'electron' ? 'electron' : 'node';

const moduleDir = dirname(require.resolve('better-sqlite3/package.json'));
const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js');

const args = ['rebuild', '--release', `--arch=${process.arch}`];
let label = `node ${process.versions.node} (ABI ${process.versions.modules})`;
if (mode === 'electron') {
  const electronVersion = require('electron/package.json').version;
  args.push(`--target=${electronVersion}`, '--dist-url=https://electronjs.org/headers');
  label = `Electron ${electronVersion}`;
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
console.log(`[rebuild-native] Fertig. better-sqlite3 ist jetzt auf ${mode}-ABI gebaut.`);
