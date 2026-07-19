# Web AI Builder — Project Plan

> AdminCave project · As of: 2026-07-12 · Status: Plan pending approval
> Basis: 4 research reports (market, subscription feasibility, architecture, design system), adversarially verified on 2026-07-11/12

## 1. Vision & Positioning

A desktop client that lets users build websites via AI chat and **deploy them to classic webspace at the push of a button** — including rollback.

**Positioning:** "Your website. Your AI. Your webspace." — English UI, GDPR/local-first, aimed at the DACH region. The app runs locally, the AI runs via the user's own subscriptions or API keys, and the site lives on the user's own webspace.

**Target audiences (in this order):**
1. The DACH hobby webmaster — "the IT person the club/family asks", running classic shared hosting (IONOS, Strato, all-inkl, Netcup, Hetzner)
2. MSPs / IT service providers with many small customer sites (later expansion stage, see §9)

**Differentiation (verified, July 2026):** No product combines polished desktop UX + subscription-based AI + live preview + SFTP deploy with rollback. The deploy part is unrivaled and free of platform risk — it is the centerpiece, not a feature.

## 2. Decisions made (Kevin, 2026-07-12)

| Decision | Outcome |
|---|---|
| Product direction | **Builder with a deploy core**: v1 = chat + live preview + checkpoints + SFTP deploy/rollback; deploy engine as a standalone module |
| AI backends | **All paths**: Claude (subscription + API), OpenAI Codex (subscription + API), generic BYO API-key mode, Gemini CLI + Grok Build |
| Voice input | **v1.1** (push-to-talk with cloud STT; local Whisper later) |
| Shell | **Electron** (rationale §4) |
| Generated sites | **Pure static HTML/CSS/JS**, no build step (Astro later as an opt-in) |

## 3. Compliance rules for subscription use (non-negotiable)

The only defensible pattern: **the app launches the official, unmodified vendor CLI that the user installed themselves and logged into themselves.**

1. The app **never** reads, stores, proxies, or transmits providers' OAuth tokens. No "Login with Claude/ChatGPT" in our app — login always happens in the provider's own flow.
2. No rerouting of backends (`ANTHROPIC_BASE_URL` or similar), no harness spoofing, no browser automation of chat UIs.
3. **Remote kill switch per provider** (remote config): Anthropic has changed direction 3× in 5 months — we need to be able to disable a subscription path overnight, without a release.
4. API-key mode is always the foundation and the fallback.
5. Branding: never use "Claude Code" as a product name; "works with Claude Agent" phrasings are fine.

**Status per provider (2026-07-12, sources in the research reports):**

| Provider | Subscription mechanism | Status | Risk | v1 stance |
|---|---|---|---|---|
| OpenAI | Codex CLI/SDK, "Sign in with ChatGPT" | Publicly welcomed, not contractually guaranteed | low–medium | On by default |
| Google | Gemini CLI (headless/ACP), Google login / AI Pro/Ultra | Explicitly permitted in the ToS (only via the CLI!) | low | On by default |
| xAI | Grok Build CLI (headless/ACP), SuperGrok login | Official; partner allowlist for direct OAuth; spawning your own CLI is tolerated | medium | On, marked as "experimental" |
| Anthropic | Claude Code (user install), `claude -p --output-format stream-json` | "Unless previously approved" forbids third-party login; end users on their own plan currently tolerated (metering paused 2026-06-15) | high | Behind a feature flag + in-app notice; **request approval from Anthropic**; API key as the recommended default |

Re-check before launch: support.claude.com/en/articles/15036540 (Agent SDK metering), developers.openai.com/codex/pricing, ai.google.dev/gemini-api/terms (EEA clause for distributed API clients!).

## 4. Architecture

**Electron 43** (instead of Tauri v2), because: the Claude Agent SDK needs Node (bundled inside Electron; Tauri would need a 60–90 MB sidecar); embedded preview is stable (`WebContentsView`/iframe vs. Tauri's multi-webview behind an `unstable` flag); Chromium renders identically on Linux (webkit2gtk fidelity issues would be fatal for a preview app); Dyad/Claudable/Crystal validate the pattern.

**Structural rule:** the agent adapters, preview server, versioning, and deploy engine are Electron-free TypeScript packages (monorepo). Electron glue lives only in main/preload. This keeps a Tauri switch and headless-CLI offshoots open.

```
apps/desktop            Electron app (main, preload, renderer: React + AdminCave DS)
packages/core           Types, AgentEvent, project registry (better-sqlite3)
packages/agents         Adapters: claude-sdk | claude-cli | codex | gemini-cli | grok-cli | byok (Vercel AI SDK v6)
packages/preview        Static server + chokidar + WS reload + HTML injection shim (console/error capture)
packages/versioning     git per workspace (simple-git, fallback isomorphic-git), checkpoints, restore
packages/deploy         Hash-manifest sync via ssh2-sftp-client / basic-ftp, rollback, preflight
```

**Workspace layout:** `~/WebAIBuilder/<project>/` with `site/` (docroot that the AI edits), `.git/`, `project.json`.

### Agent adapters (one interface, six backends)

```ts
interface AgentBackend {
  capabilities(): { resume: boolean; partialText: boolean; cost: boolean };
  runTurn(req): AsyncIterable<AgentEvent>;   // text-delta | tool-activity | permission-request | turn-complete | error
  interrupt(): Promise<void>;
}
```

- **File changes come from the chokidar watcher** (ground truth), not from tool-call parsing → identical behavior across all backends.
- Adapters: `claude-sdk` (`@anthropic-ai/claude-agent-sdk`, API key, `canUseTool` → permission-request) · `claude-cli` (system `claude -p --output-format stream-json --input-format stream-json --include-partial-messages`, subscription) · `codex` (`@openai/codex-sdk`, subscription + API) · `gemini-cli` (`gemini -p --output-format stream-json --approval-mode auto_edit`) · `grok-cli` (`grok -p`, headless) · `byok` (Vercel AI SDK v6 tool loop with our own workspace-scoped read/write/edit tools; covers all 4 providers via API key).
- Permission policy default: auto-approve for edits in `<workspace>/site/`, deny outside, prompt for shell/network.
- Note ACP (agentclientprotocol.com) for later as a "long-tail" adapter (Gemini & Grok speak it natively).

### Live preview

Our own ~200-line static server + chokidar + WebSocket reload; injection middleware inserts a reload client + console/error shim into every page (Dyad-proven pattern). Panel = sandboxed `<iframe>` on `127.0.0.1:<random-port>` with a token; swapping the panels left/right = CSS grid order. The shim catches `window.onerror`/`unhandledrejection`/`console.*` → a **"Fix error" button** templates the error into a chat turn.

### Versioning

Real git per workspace (the user can open it with ordinary git; the UI never says "git"). A checkpoint per agent turn (`commit` with the first prompt line; trailers: turn ID, backend, session, cost). Named versions = annotated tags + a display name in the DB. **Restore-as-a-new-commit** (linear, lossless, no detached HEAD); dirty state is auto-checkpointed beforehand.

### Deploy engine (the centerpiece)

- Transports: `ssh2-sftp-client` v12 (SFTP) + `basic-ftp` v6 (FTP/FTPS incl. TLS session reuse — many shared hosts require it). rsync only as a detected opt-in transport (Windows problem).
- **Hash-manifest sync** (pattern from SamKirkland/FTP-Deploy-Action): a local hash tree vs. `.wab-manifest.json` on the server → minimal upload/delete operations. Ordering for quasi-atomicity: uploads → deletes → manifest last.
- The manifest stores the **commit SHA** → a "Deployed" badge in the timeline; drift detection on connect.
- **Rollback** = materialize the old version from git into a temp dir, hash-diff against the remote manifest, delta upload. Works on the dumbest host, in seconds for static sites.
- Preflight connection test + capability probe per host; test matrix: Hetzner, IONOS, all-inkl, Strato, Netcup.
- Credentials: `@napi-rs/keyring` → OS keychain (no bare `safeStorage` — Linux plaintext trap); warn if no Secret Service is available.

### Security

`contextIsolation` + renderer `sandbox`, IPC sender validation, `will-navigate` deny-by-default, `setPermissionRequestHandler`; the preview server is loopback-only with a random port + token, `postMessage` origin checks. (The preview renders AI-generated HTML/JS — that is our largest attack surface.)

## 5. UI / Design

Strictly following the AdminCave design system (github.com/AdminCave/DesignSystem, fully extracted):
- Dark-mode-first on black (`--bg #000`), light via `data-theme="light"`; monochrome + hairlines, blue accent `#4f9dff` (at most one emphasized action per view)
- Geist / Geist Mono; mono for metadata (versions, timestamps, ports); pill buttons (primary = white-on-black in dark); cards with a 16px radius and no shadow at rest; active navigation = weight + underline, never a filled pill
- English; no emojis in product copy, no gradients
- Layout v1: title bar · chat panel ⟷ preview panel (swappable) · timeline sidebar (checkpoints, Deployed badge) · status bar (backend, cost, deploy status)

## 6. Milestones

**M0 — Foundation (setup)**
Monorepo (pnpm), Electron shell with security hardening, React + design tokens from the DS repo, CI (lint/test/build for Linux/Win/mac), project registry.

**M1 — Workspace core**
`packages/versioning` (init, checkpoint, restore, tags) + `packages/preview` (server, watcher, reload, shim) + project creation with 2–3 starter templates (static, DS-compliant). Result: create a project, edit files by hand, preview updates live, timeline shows checkpoints.

**M2 — AI chat (first backends)**
`packages/agents` with `byok` (Vercel AI SDK, workspace-scoped tools) and `claude-sdk` (API key). Chat UI with streaming, tool-activity display, permission prompts, a checkpoint per turn, "Fix error" button. Result: build a website via chat with an API key.

**M3 — Deploy engine**
`packages/deploy` complete: SFTP/FTPS, manifest sync, preflight, rollback, keychain, deploy UI + Deployed badge + deploy history. Tested against the host matrix. Result: push-button deploy + rollback — the unique selling point is in place.

**M4 — Subscription backends**
`claude-cli` (user install, feature flag + notice), `codex` (subscription + API), `gemini-cli`, `grok-cli` (experimental). Backend detection ("Claude Code found, logged in as …"), onboarding deep links to the vendor installers, remote kill-switch config. In parallel (non-code): submit the approval request to Anthropic.

**M5 — Release polish (v1)**
German onboarding, electron-updater, packaging (deb + AppImage, NSIS, notarized dmg), error reports, docs. Website/repo setup under AdminCave.

**v1.1 (afterwards):** push-to-talk voice (cloud STT with user key), diff viewer per checkpoint, Netlify/CF Pages targets, possibly an ACP adapter.
**Later:** local Whisper, Astro project type, MSP fleet expansion (§9).

## 7. Risks & countermeasures

| # | Risk | Countermeasure |
|---|---|---|
| 1 | Anthropic/vendor kills the subscription path | Only spawn official CLIs; API-key foundation; kill switch; request approval; Codex/Gemini as stable alternatives |
| 2 | Dyad copies our features | Speed on the deploy core (their issue #2636 is open, not built); DACH/GDPR positioning that Dyad does not occupy |
| 3 | CLI protocol drift (stream-json, flags) | Prefer SDKs with pinned CLI versions; capability detection from the init event; contract tests per adapter in CI |
| 4 | Shared-hosting heterogeneity | Manifest sync + safe operation ordering + resumability; preflight probe; host test matrix |
| 5 | Preview renders AI code | iframe sandbox, loopback+token, origin checks, Electron hardening |
| 6 | Linux desktop variance (core audience) | keyring with backend detection + warning; deb + AppImage; CI smoke on GNOME/KDE/Wayland/X11 |
| 7 | Scope explosion (which killed competitors) | Voice, SSG, multi-session, code editor explicitly NOT in v1 |

## 8. Explicitly NOT in v1

Voice (→ v1.1) · local Whisper · rsync default · "safe-swap"/symlink deploys · Netlify/CF Pages · Astro/build pipelines · ACP adapter · MCP configuration UI · subagents/worktrees · in-app code editor (at most a read-only viewer) · diff viewer (only a file-change list) · image generation · forms/backend features · i18n beyond English.

## 9. Later expansion stage: MSP fleet (validate, do not build)

The market report sees the strongest willingness to pay among IT service providers who maintain 10–50 customer sites (fleet dashboard, AI edits via their own subscription, deploy + rollback per customer, monitoring). This remains a v2 candidate — validate first (interviews) once v1 shows traction.

## 10. Open items

- [ ] Product name final? (working title: Web AI Builder)
- [ ] License/OSS question: open like Dyad (Apache + FSL for the Pro parts) or closed? — **Owner decision, still open.** The README marks the license as TBD; deliberately still NO `LICENSE` file.
- [ ] Before launch: re-check the vendor terms (§3)
- [ ] Finalize app icons + arm code signing/notarization (Windows cert, macOS notarization) for the packaged installers
- [x] Distribution: GitHub Releases is enough for v1 — set up in M5 (electron-builder + `release.yml` build for all three platforms on tag push)
- [ ] UI icons: currently lucide-react behind the `<Icon>` registry (`renderer/src/components/icons.ts`) — replace with our own AdminCave DS icons later if needed (just swap the registry)
- [ ] "Named versions": `nameVersion` (annotated tags) is finished in `packages/versioning` but has no IPC channel/UI yet (timeline action "Name version")
- [x] M5 packaging: better-sqlite3/Electron ABI — **solved.** electron-builder rebuilds the app deps automatically when packaging (`npmRebuild`); the install/test path stays node-ABI (no postinstall rebuild). See SETUP.md.

## 11. Progress

- [x] **M0 — Foundation**: pnpm monorepo, hardened Electron shell, React renderer with a three-panel layout, design tokens vendored, CI. Typecheck/build/lint green.
- [x] **M1 — Workspace core**: `versioning` (git checkpoints, restore-as-a-new-commit, 15 tests), `preview` (loopback server + token + live reload + error shim, 8 tests), project registry (better-sqlite3, 12 tests) + 3 static starter templates. 35 tests green.
- [x] **M2 — AI chat**: `agents` with `byok` (Vercel AI SDK v7, sandboxed file tools, path containment incl. symlink protection) + `claude-sdk` (17 tests); desktop integration: preview lifecycle, agent-event streaming, chat UI with tool chips + permission prompt + "Fix error", a checkpoint per turn, timeline with restore (40 tests). 80 tests green.
  - Open seam: the permission back channel — the adapter denies fail-safe, the desktop uses the generator's `next(decision)`. The clean fix: a `resolve` callback on the `permission-request` event in core. Reconcile in M4 (only load-bearing once shell/network tools appear). The API key currently lives only in main-process memory → OS keychain in M3.
- [x] **M3 — Deploy engine**: the `deploy` package with a transport abstraction (SFTP/FTP/FTPS), hash-manifest sync with delta upload, preflight/capability probe, rollback, drift detection — tested against real in-process servers (16 tests, both transports). Keychain migration (`@napi-rs/keyring`, fallback + warning). Desktop: target management, "Test connection", "Publish" with live progress, a "Deployed" badge in the timeline, drift warning, "deploy this version" per checkpoint, deploy history. 158 tests green (desktop 102).
- [x] **M4 — Subscription backends**: four CLI adapters (`claude-cli`, `codex`, `gemini-cli`, `grok-cli`) — they spawn the official vendor CLI installed and logged in by the user, no token/base-URL handling (43 agents tests). The permission back channel cleanly reconciled (via `requestId` + generator return value, without a core change). Real backend detection (installed? logged in?), onboarding deep links, fail-safe remote kill switch per provider, Claude subscription feature flag + notice/confirmation. Subscription backend selectable as the active backend with a readiness gate in the main process. 248 tests green (desktop 166).
  - Compliance verified: only official CLIs, no token/base-URL assignments in the code (only comments that record the rule).
- [x] **M5 — Release polish**: two parts.
  - *Part 1 (packaging/auto-update):* electron-builder (deb + AppImage, NSIS, dmg), electron-updater against GitHub Releases with an update notice in the UI, release CI on tag push. `nodeLinker: hoisted` + rebuild-on-packaging solve the Electron ABI question without touching the node-ABI test path.
  - *Part 2 (onboarding/error reports/docs):* first-start onboarding (three screens — Welcome · Choose AI · Webspace — AdminCave DS, skippable, re-openable from the settings; `hasOnboarded` under `<userData>`). Robust, **purely local** error/log capture: process/app hooks (`uncaughtException`/`unhandledRejection`/`render-process-gone`/`child-process-gone`/`console-message`) + a typed renderer report channel → a rotating file under `<userData>/logs/` (size cap, last N files), secret-shaped fields are scrubbed before writing; UI access "Errors & logs" (path, open folder, copy last lines). **No remote sending** (GDPR/local-first, §1); an optional remote report deliberately remains an OFF/opt-in TODO with no endpoint. Docs: README, CONTRIBUTING, SETUP addendum. Bridge surface additive on v6 (`onboarding.*`, `logs.*`). 289 tests green (desktop 207), 6 projects.
  - License deliberately left open (owner decision, §10): the README calls it TBD, and no `LICENSE` file is included.
- [x] **Polish round "Unblock chat · Settings redesign · Icons" (2026-07-15)**:
  - *Chat usable (core problem "detects Claude, but nothing works"):* an env key (`ANTHROPIC_API_KEY` & co.) now also counts for unblocking, not just for detection (`PROVIDER_ENV_KEYS`, `apiKeySource`; keychain wins). A single shared readiness source `chatBlockReason` (shared/backends). Chat empty state with a guided setup path (`recommendChatSetup`): "Claude (subscription) found — set up now" → notice → confirm → activate in one flow (the ack stays explicit, PLAN §3). A real login probe (`claude auth status` JSON / `codex login status`, fail-safe) → "logged in as …" instead of an eternal "found". Error causes (401, model) surfaced all the way to the UI (expandable details + `errorHints`); `settings.get` errors as a banner with retry. A watchdog in `cliEngine` (default 120 s, paused while a permission is open) against silently hanging CLIs.
  - *Settings redesign:* a modal with side navigation (AI & backends · Appearance · Help & logs, `shared/settingsNav.ts`), ONE activation path for all six backends (cards with an inline form; the BackendPicker + old form duplication removed), deep links (chat → byok card), Ctrl/Cmd+, + Escape.
  - *Icons:* `lucide-react` behind our own `<Icon>` component + registry (`icons.ts` = the single swap layer for later DS icons); title bar, settings nav, backend status (check/dot/alert), chat, preview, timeline, StatusBar, deploy.
  - *Robustness:* app start crash-safe (try/catch + error dialog instead of a windowless process); `pnpm dev`/`test` toggle the better-sqlite3 ABI automatically (marker, `rebuild-native.mjs --if-needed`); a React error boundary app-wide + per panel; zod validation of the IPC arguments (`ipcSchemas.ts`); CI now runs `pnpm test`.
  - *Flow fixes:* restore/template/project-list errors made visible (instead of silent), preview "Try again" on error, proactive drift check (the deploy.drift channel finally wired up), deploy `outcome` rendered, cost chip only for real cost, rename/remove project in the StartScreen.
  - Tests: 333 green (desktop 239, agents 55, preview 8, deploy 16, versioning 15); typecheck/lint/build green. GUI smoke (onboarding→chat→deploy in both themes) is still pending as a manual check — this round ran in a TTY session without a display.
