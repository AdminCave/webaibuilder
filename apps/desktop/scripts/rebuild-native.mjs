// Rebuilds the ABI-specific native module (better-sqlite3) for the desired
// runtime target. Background: better-sqlite3 is NAN-based (not N-API), so the
// compiled .node file must match the runtime's ABI.
//   - `node`     → for `pnpm -r test` (Vitest runs under system Node)
//   - `electron` → for `pnpm dev` and packaging (Electron ships its own ABI)
// @napi-rs/keyring, by contrast, is N-API (ABI-stable) and needs NO rebuild.
//
// Usage: `node scripts/rebuild-native.mjs electron|node [--if-needed]`
// Cross-platform (spawns node-gyp via process.execPath, no shell cd).
//
// `--if-needed` (dev/test scripts): builds only when the existing .node file
// does not match the target according to the ABI marker — the dev<->test toggle
// runs automatically that way, but costs nothing when the ABI already matches.

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

// The marker lives in build/ — `node-gyp rebuild` clears that directory, so a
// stale marker can never prevent a needed rebuild.
const markerPath = join(moduleDir, 'build', '.wab-abi');
if (ifNeeded && existsSync(markerPath)) {
  try {
    if (readFileSync(markerPath, 'utf8').trim() === target) {
      console.log(`[rebuild-native] better-sqlite3 is already built for ${label} — skipping.`);
      process.exit(0);
    }
  } catch {
    /* Marker unreadable → rebuild to be safe. */
  }
}

console.log(`[rebuild-native] better-sqlite3 → ${label}\n  in ${moduleDir}`);
const result = spawnSync(process.execPath, [nodeGyp, ...args], {
  cwd: moduleDir,
  stdio: 'inherit',
});
if (result.status !== 0) {
  console.error(`[rebuild-native] Failed (exit ${result.status ?? 'unknown'}).`);
  process.exit(result.status ?? 1);
}
try {
  writeFileSync(markerPath, `${target}\n`);
} catch {
  /* Without a marker, --if-needed just rebuilds next time — not critical. */
}
console.log(`[rebuild-native] Done. better-sqlite3 is now built for the ${mode} ABI.`);
