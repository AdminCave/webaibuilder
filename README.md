<!-- AdminCave logo: assets/logo in the DesignSystem repo (github.com/AdminCave/DesignSystem). -->
<!-- ![AdminCave](https://raw.githubusercontent.com/AdminCave/DesignSystem/main/assets/logo.svg) -->

# Web AI Builder

**Your website. Your AI. Your web space.**

Web AI Builder is a desktop client that lets you build websites through an AI chat and **deploy them to your own web space at the push of a button** — rollback included. Everything runs locally on your machine: the AI through your own subscriptions or API keys, the site on your own hosting. No cloud in between, no intermediate storage, no third-party servers.

An AdminCave project. Local-first and GDPR-conscious, built for the German-speaking (DACH) market.

> Status: v1 (milestones M0–M5 complete). See [Status / Roadmap](#status--roadmap).

> **Note on language:** the source, docs, and commit history of this project are in **English**. The shipped **app UI is German** on purpose — the target audience is the DACH region. See [Localization](#localization).

<!-- TODO(screenshot): three-panel view — Chat ⟷ Live Preview ⟷ Timeline. -->
<!-- ![Web AI Builder — screenshot](docs/screenshot.png) -->
_Screenshot coming soon._

## Why

For the DACH "IT person the club or the family asks": classic shared hosting (IONOS, Strato, all-inkl, Netcup, Hetzner), a small site, little appetite for build pipelines and cloud subscriptions. Web AI Builder combines a polished desktop UX, AI through your own subscription, and — the heart of it — SFTP deploy with rollback. That combination does not exist anywhere else.

## Your model: your own subscription OR your own API key

You decide how the AI runs, and you can mix both paths:

- **Your own API key** — you store a key from Anthropic, OpenAI, Google, or xAI. The key lives in your **operating system's keychain**, never in plaintext on disk. A key present in the environment (e.g. `ANTHROPIC_API_KEY`) is picked up automatically.
- **Your own subscription via CLI** — uses your existing subscription (Claude, Codex, Gemini, Grok) through the provider's **official CLI**, which you install and log into yourself.

**Compliance note (important):** this app **never** reads, stores, proxies, or transmits your provider tokens. There is no "log in with Claude/ChatGPT" inside this app — on the subscription path the login happens exclusively in the provider's official CLI. Web AI Builder only launches what you have set up and logged into yourself, and never redirects any backend. The API-key mode is always the foundation and the fallback.

## Features

- **AI chat** — describe what you want; the AI edits your site's files. Tool activity, permission prompts, and a "fix error" button included. If no backend is ready yet, the empty chat guides you through a one-click setup instead of sitting there disabled.
- **Live preview** — every change appears instantly in a sandboxed preview (loopback server, token-protected). The chat and preview panels are swappable.
- **Git checkpoints** — one checkpoint per chat turn (real git under the hood). Restore-as-a-new-commit — linear, lossless, no fiddling.
- **SFTP/FTP deploy with rollback** — only changed files are uploaded (hash-manifest sync). The deployed state is remembered; roll back to an earlier version in seconds.

## Supported AI backends

| Path | Backend | Provider | Note |
|---|---|---|---|
| API key | `byok` | Anthropic, OpenAI, Google, xAI | Your own key, model freely selectable |
| API key | `claude-sdk` | Anthropic | Claude Agent SDK with an API key |
| Subscription (own CLI) | `claude-cli` | Claude | Behind a feature flag + in-app notice |
| Subscription (own CLI) | `codex` | OpenAI Codex | Subscription **and** API key |
| Subscription (own CLI) | `gemini-cli` | Google Gemini | Allowed through the CLI per ToS |
| Subscription (own CLI) | `grok-cli` | xAI Grok | **experimental** |

For every subscription backend the app detects whether the CLI is installed and logged in (e.g. "logged in as …"), and otherwise links the official install/sign-in guide. A per-provider remote kill switch makes it possible to disable a subscription path overnight if a provider changes its rules.

## Supported deploy targets

Classic shared hosting via **SFTP**, **FTP**, and **FTPS** (FTP over TLS, including the session reuse many hosts require). Tested against the host matrix: Hetzner, IONOS, all-inkl, Strato, Netcup. Credentials live in the OS keychain. Deploy targets are configured **per project**.

## Architecture

An Electron shell with a hardened renderer (contextIsolation + sandbox, typed preload bridge). The domain logic lives in Electron-free TypeScript packages — which keeps a later Tauri swap and a headless offshoot open.

- [`apps/desktop`](apps/desktop) — Electron app (main, preload, React renderer on the AdminCave design system)
- [`packages/core`](packages/core) — shared types, `AgentEvent`, permission policy, IPC registry
- [`packages/agents`](packages/agents) — the six agent adapters (`byok` + five vendor paths)
- [`packages/preview`](packages/preview) — live-preview server + watcher + reload + error shim
- [`packages/versioning`](packages/versioning) — git per workspace, checkpoints, restore
- [`packages/deploy`](packages/deploy) — hash-manifest sync over SFTP/FTPS, rollback, preflight

More background: [`PLAN.md`](PLAN.md).

## Privacy & error reports

Local-first, no telemetry. When something goes wrong, the details land in a **local, rotating log** under `<userData>/logs/` on your machine. From **Settings → Errors & Logs** you can open the folder or copy the last lines — **nothing is sent to any server**. Known secret-shaped fields (API keys, passwords, tokens) are scrubbed from the logs before they are written.

## Localization

The **app UI is German** — a deliberate product decision for the DACH target audience (informal "du", no emojis). Everything a developer touches — source code, comments, docs, commit messages, identifiers — is **English**. If broader UI localization becomes a goal, the user-facing strings are the layer to internationalize; the surrounding code already reads as English.

## Install & development

Prerequisites and all scripts are in [`SETUP.md`](SETUP.md). In short:

```bash
pnpm install
pnpm dev        # app in dev mode (needs a display)
pnpm test       # tests (headless)
pnpm package    # installer for the current platform
```

`pnpm dev` and `pnpm test` automatically rebuild the one ABI-sensitive native module (`better-sqlite3`) for the right runtime (Electron vs. Node) when needed — no manual toggle. Installers are built with electron-builder (Linux `AppImage` + `deb`, Windows `nsis`, macOS `dmg`), with auto-update over GitHub Releases.

## Status / Roadmap

**v1 — complete:**

- **M0** Foundation: hardened Electron shell, React renderer, design tokens, CI
- **M1** Workspace core: git checkpoints, live preview, starter templates
- **M2** AI chat: `byok` + `claude-sdk`, streaming, tool activity, "fix error"
- **M3** Deploy engine: SFTP/FTPS, manifest sync, rollback, drift detection, keychain
- **M4** Subscription backends: `claude-cli`, `codex`, `gemini-cli`, `grok-cli`, detection, kill switch
- **M5** Release polish: onboarding, auto-update, packaging, error reports, docs
- **Polish pass:** guided chat setup (env-key readiness, real login detection, visible error causes, CLI watchdog), settings redesign with side navigation, an icon set, crash-safe startup, a React error boundary, and runtime IPC validation

**v1.1 — next:** push-to-talk voice (cloud STT with your own key), per-checkpoint diff viewer, Netlify/Cloudflare Pages targets.

**Later:** local Whisper, an Astro project type, MSP fleet expansion.

## License

**Undecided (TBD).** The license/OSS question is a deliberate owner decision that has not been made yet — open (e.g. Apache 2.0, possibly with an FSL for later pro parts, à la Dyad) or closed. Until then there is **no** `LICENSE` file; all rights reserved.

<!-- TODO(LICENSE): owner to decide the license and add a LICENSE file (PLAN.md §10). -->
