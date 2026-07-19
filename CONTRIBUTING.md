# Contributing to Web AI Builder

Thanks for taking a look. This file briefly summarizes how the repo is structured and what to keep in mind when contributing. In-depth material on architecture and roadmap is in [`PLAN.md`](PLAN.md), the developer setup in [`SETUP.md`](SETUP.md).

## Monorepo layout

pnpm workspace, TypeScript. The domain logic lives in Electron-free packages; the Electron glue lives only in the app.

- `apps/desktop` — the Electron app (main, preload, React renderer in the AdminCave design system)
- `packages/core` — shared types (`AgentEvent`, permission policy, project/workspace types, IPC registry)
- `packages/agents` — the six agent adapters (`byok`, `claude-sdk`, `claude-cli`, `codex`, `gemini-cli`, `grok-cli`)
- `packages/preview` — live preview: static server + watcher + WS reload + error shim
- `packages/versioning` — real git per workspace: checkpoints, restore-as-a-new-commit, named versions
- `packages/deploy` — deploy engine: hash-manifest sync via SFTP/FTPS, rollback, preflight

## Getting started

```bash
pnpm install       # once
pnpm dev           # app in dev mode (needs a display)
pnpm typecheck     # TypeScript strict across all packages
pnpm test          # Vitest, headless (pnpm -r test)
pnpm lint          # ESLint
pnpm package       # installers for the current platform
```

Details (native modules, Electron ABI vs. node ABI, headless environment) are in [`SETUP.md`](SETUP.md). Before you open a PR: `pnpm typecheck && pnpm build && pnpm -r test` must be green.

## Conventions

- **TypeScript strict.** No `any`, no silent casts. New logic is typed and tested.
- **Electron-free packages.** `packages/*` **never** imports `electron` or Node GUI specifics. Everything Electron-/Node-bound lives in `apps/desktop/src/main` or `preload`. This keeps the packages headless-testable and a Tauri switch open.
- **core-frozen / desktop-additive.** `packages/core` (IPC registry, bridge contract, `BRIDGE_VERSION`) is frozen. New IPC channels and bridge surface are added additively in `apps/desktop/src/shared` (bump its own `WAB_DESKTOP_BRIDGE_VERSION`). Channels follow `wab:v<version>:<domain>:<action>` and are fully typed.
- **Keep the security posture (M0).** `contextIsolation` + renderer `sandbox`, IPC sender validation, deny-by-default for navigation/permissions. The renderer speaks exclusively through the typed preload bridge — no new ways around it.
- **UI copy: English.** No emojis in the product UI, no gradients. Strictly the AdminCave design system (hairlines, Geist/Geist Mono, one blue accent, pill buttons, monochrome). Metadata (ports, timestamps, versions) in mono.
- **Tests headless.** Vitest runs without a display/DOM (node environment). Pure logic belongs in `shared`/packages and is tested there; paths are injected (no `app.getPath` in testable logic).

## Compliance rule for AI backends (non-negotiable)

See [`PLAN.md` §3](PLAN.md). Short and binding for every contribution that touches subscription backends:

- The app launches exclusively the **official, unmodified vendor CLI** that the user installed themselves and logged into themselves.
- **No token handling.** Never read, store, proxy, or transmit providers' OAuth/session tokens. No "Login with …" in our app.
- **No backend rerouting** (`ANTHROPIC_BASE_URL` or similar), no harness spoofing, no browser automation of chat UIs.
- API-key mode stays the foundation and the fallback. Subscription paths sit behind detection + a remote kill switch (+ confirmation for Claude).

PRs that violate this rule (e.g. introducing token persistence or a base-URL assignment) will not be accepted.

## Error reports

Error/log capture is **purely local** (a rotating file under `<userData>/logs/`). No remote sending, no endpoint — that is part of the local-first positioning (PLAN §1). If you write context into the log: the logger scrubs known secret-shaped fields, but never deliberately log credentials anyway.
