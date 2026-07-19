# Web AI Builder — Developer Setup

Prerequisites: Node ≥ 22, `corepack enable` (activates pnpm). See `PLAN.md` for architecture and roadmap.

## Installation

```bash
pnpm install
```

## Scripts (repo root)

| Command | Purpose |
|---|---|
| `pnpm dev` | Vite + Electron in dev mode (needs a display; see note below) |
| `pnpm typecheck` | TypeScript strict across all packages |
| `pnpm build` | Build all packages + renderer |
| `pnpm lint` | ESLint |
| `pnpm -r test` | Vitest in all packages (system Node / node-ABI) |
| `pnpm package` | Build installers for the current platform (electron-builder) |
| `pnpm package:linux` | Build the Linux installers (AppImage + deb) |

## Packaging & auto-update (M5)

Installers are built with **electron-builder** (config: `apps/desktop/electron-builder.yml`). Targets: Linux `AppImage` + `deb`, Windows `nsis`, macOS `dmg`. `pnpm package` builds for the current platform, `pnpm package:linux` targets the Linux installers specifically. On a `v*` tag push, CI (`.github/workflows/release.yml`) builds the installers for all three platforms and uploads them, together with the auto-update metadata, to GitHub Releases.

**Auto-update** (electron-updater) checks in the packaged build at startup and periodically against GitHub Releases (`AdminCave/webaibuilder`), downloads in the background, and reports "update ready" to the UI (restart on click, otherwise on quit). In dev (`!app.isPackaged`) the updater is a no-op.

### Start the app in dev mode (with a display)

```bash
pnpm install   # only the first time / after changes
pnpm dev       # rebuilds better-sqlite3 for the Electron ABI on demand, then Vite + Electron
```

The ABI toggle runs automatically: `pnpm dev` and `pnpm test` check a marker (`node_modules/better-sqlite3/build/.wab-abi`) before starting and only rebuild better-sqlite3 if the ABI does not match the target runtime. Manual `rebuild:electron`/`rebuild:node` is only needed for special cases now (a forced rebuild).

### Native module (better-sqlite3) & the Electron ABI

Only **one** module is ABI-sensitive:

- **`better-sqlite3`** (project registry) is NAN-based — the compiled `.node` file must match the **ABI of the runtime**. Node 22 and Electron 43 have different ABIs (127 vs. 148); the same binary does **not** run in both. Hence the toggle: Electron ABI for `pnpm dev`/`package`, node ABI for the Vitest tests. `scripts/rebuild-native.mjs` rebuilds better-sqlite3 specifically (and only that module) with node-gyp — cross-platform, without the broken `install-app-deps` path (which fails on ssh2's optional `cpu-features` dependency). The dev/test scripts call it with `--if-needed` (the marker file decides), the package scripts force the Electron build.
- **`@napi-rs/keyring`**, by contrast, is **N-API** (ABI-stable) and runs in Node **and** Electron without a rebuild.

If you still get a `NODE_MODULE_VERSION` or "Module did not self-register" message, it tells you exactly which ABI is expected — then run the matching `rebuild:*`.

**Packaging:** `pnpm package` builds better-sqlite3 for Electron ahead of time (`rebuild:electron`) and then packages with `npmRebuild: false` — so electron-builder rebuilds **nothing** natively (and does not trip over `cpu-features`), but bundles the already-matching binaries instead. For electron-builder to find all production deps in the pnpm monorepo, `nodeLinker: hoisted` in `pnpm-workspace.yaml` is required (a flat `node_modules`; a documented pnpm fix, electron-builder#6389).

### "Error: Electron uninstall" on the first `pnpm dev`

electron-vite cannot find the Electron binary — it was not downloaded during `pnpm install` (pnpm sometimes skips build scripts when `node_modules` already exists). Catch it up once:

```bash
node node_modules/electron/install.js      # downloads the Electron binary
# or:  pnpm rebuild electron
```

Then run `pnpm dev` again. A truly fresh `pnpm install` (or `--frozen-lockfile` in CI) downloads the binary itself, because `electron` is allowed in `allowBuilds`.

## Onboarding & error reports (M5)

On first start, the app shows a short German onboarding (three screens). The remember flag (`hasOnboarded`) lives in `<userData>/onboarding-state.json`; via **Settings → Show introduction again** you restart the flow.

Error and log capture is **purely local** (no remote sending, PLAN §1): a rotating file logger writes structured JSON lines to `<userData>/logs/app.log` (size cap + last N rotated files). Captured are `uncaughtException`/`unhandledRejection`, renderer crashes (`render-process-gone`), and reported renderer JS errors; secret-shaped fields (API keys, passwords, tokens) are removed before writing. In the app: **Settings → Errors & logs** (show path, open folder, copy last lines). When debugging you can find `<userData>` on Linux, for example, under `~/.config/Web AI Builder/`.

## Headless environment (no display)

- Tests and `typecheck`/`build` run without a display.
- The Electron main process boots headless (`WAB_SMOKE=1` + `--ozone-platform=headless`); window creation needs `xvfb-run` (`sudo apt install xvfb`), otherwise it aborts for lack of a display — that is environmental, not a code bug.
