# Web AI Builder — Projektplan

> AdminCave-Projekt · Stand: 2026-07-12 · Status: Plan zur Freigabe
> Basis: 4 Recherche-Reports (Markt, Abo-Machbarkeit, Architektur, Design-System), adversarial verifiziert am 11./12.07.2026

## 1. Vision & Positionierung

Ein Desktop-Client, mit dem Nutzer per KI-Chat Webseiten erstellen und **per Knopfdruck auf klassischen Webspace deployen** — inklusive Rollback.

**Positionierung:** „Deine Webseite. Deine KI. Dein Webspace." — Deutsch-first, DSGVO/Local-first. Die App läuft lokal, die KI läuft über die eigenen Abos oder API-Keys des Nutzers, die Seite liegt auf dem eigenen Webspace.

**Zielgruppen (in dieser Reihenfolge):**
1. Der DACH-Hobby-Webmaster — „die IT-Person, die der Verein/die Familie fragt", mit klassischem Shared Hosting (IONOS, Strato, all-inkl, Netcup, Hetzner)
2. MSPs / IT-Dienstleister mit vielen kleinen Kundenseiten (spätere Ausbaustufe, siehe §9)

**Differenzierung (verifiziert, Juli 2026):** Kein Produkt kombiniert polierte Desktop-UX + Abo-basierte KI + Live-Preview + SFTP-Deploy mit Rollback. Der Deploy-Teil ist konkurrenzlos und plattformrisikofrei — er ist das Herzstück, nicht ein Feature.

## 2. Getroffene Entscheidungen (Kevin, 2026-07-12)

| Entscheidung | Ergebnis |
|---|---|
| Produktrichtung | **Builder mit Deploy-Kern**: v1 = Chat + Live-Preview + Checkpoints + SFTP-Deploy/Rollback; Deploy-Engine als eigenständiges Modul |
| KI-Backends | **Alle Pfade**: Claude (Abo + API), OpenAI Codex (Abo + API), generischer BYO-API-Key-Modus, Gemini CLI + Grok Build |
| Spracheingabe | **v1.1** (Push-to-talk mit Cloud-STT; lokales Whisper später) |
| Shell | **Electron** (Begründung §4) |
| Generierte Seiten | **Pures statisches HTML/CSS/JS**, kein Build-Step (Astro später als Opt-in) |

## 3. Compliance-Regeln für Abo-Nutzung (nicht verhandelbar)

Das einzige haltbare Muster: **Die App startet die offizielle, unveränderte Vendor-CLI, die der Nutzer selbst installiert und selbst eingeloggt hat.**

1. Die App liest, speichert, proxied oder überträgt **niemals** OAuth-Tokens der Anbieter. Kein „Login mit Claude/ChatGPT" in unserer App — Login passiert immer im Flow des Anbieters.
2. Kein Umleiten von Backends (`ANTHROPIC_BASE_URL` o.ä.), kein Harness-Spoofing, keine Browser-Automation von Chat-UIs.
3. **Remote-Kill-Switch pro Anbieter** (Remote-Config): Anthropic hat 3× in 5 Monaten die Richtung geändert — wir müssen einen Abo-Pfad über Nacht deaktivieren können, ohne Release.
4. API-Key-Modus ist immer das Fundament und der Fallback.
5. Branding: nie „Claude Code" als Produktname verwenden; „works with Claude Agent"-Formulierungen sind ok.

**Status pro Anbieter (12.07.2026, Quellen in den Research-Reports):**

| Anbieter | Abo-Mechanismus | Status | Risiko | v1-Haltung |
|---|---|---|---|---|
| OpenAI | Codex CLI/SDK, „Sign in with ChatGPT" | Öffentlich begrüßt, nicht vertraglich garantiert | niedrig–mittel | Standardmäßig an |
| Google | Gemini CLI (headless/ACP), Google-Login / AI Pro/Ultra | Explizit in ToS erlaubt (nur durch die CLI!) | niedrig | Standardmäßig an |
| xAI | Grok Build CLI (headless/ACP), SuperGrok-Login | Offiziell, Partner-Allowlist fürs direkte OAuth; eigene CLI spawnen toleriert | mittel | An, als „experimentell" markiert |
| Anthropic | Claude Code (Nutzer-Install), `claude -p --output-format stream-json` | „Unless previously approved" verboten für Dritt-Login; Endnutzer auf eigenem Plan aktuell geduldet (Metering pausiert 15.06.2026) | hoch | Hinter Feature-Flag + In-App-Hinweis; **Genehmigung bei Anthropic anfragen**; API-Key als empfohlener Standard |

Vor Launch erneut prüfen: support.claude.com/en/articles/15036540 (Agent-SDK-Metering), developers.openai.com/codex/pricing, ai.google.dev/gemini-api/terms (EEA-Klausel für verteilte API-Clients!).

## 4. Architektur

**Electron 43** (statt Tauri v2), weil: Claude Agent SDK braucht Node (in Electron gebündelt, Tauri bräuchte 60–90-MB-Sidecar); eingebettete Preview stabil (`WebContentsView`/iframe vs. Tauris multi-webview hinter `unstable`-Flag); Chromium rendert auf Linux identisch (webkit2gtk-Fidelity-Probleme wären für eine Preview-App fatal); Dyad/Claudable/Crystal validieren das Muster.

**Strukturregel:** Agent-Adapter, Preview-Server, Versionierung und Deploy-Engine sind Electron-freie TypeScript-Pakete (Monorepo). Electron-Glue nur in main/preload. Hält Tauri-Wechsel und Headless-CLI-Ableger offen.

```
apps/desktop            Electron-App (main, preload, renderer: React + AdminCave-DS)
packages/core           Typen, AgentEvent, Projekt-Registry (better-sqlite3)
packages/agents         Adapter: claude-sdk | claude-cli | codex | gemini-cli | grok-cli | byok (Vercel AI SDK v6)
packages/preview        Statischer Server + chokidar + WS-Reload + HTML-Injection-Shim (Console/Error-Capture)
packages/versioning     git pro Workspace (simple-git, Fallback isomorphic-git), Checkpoints, Restore
packages/deploy         Hash-Manifest-Sync über ssh2-sftp-client / basic-ftp, Rollback, Preflight
```

**Workspace-Layout:** `~/WebAIBuilder/<projekt>/` mit `site/` (Docroot, das die KI editiert), `.git/`, `project.json`.

### Agent-Adapter (ein Interface, sechs Backends)

```ts
interface AgentBackend {
  capabilities(): { resume: boolean; partialText: boolean; cost: boolean };
  runTurn(req): AsyncIterable<AgentEvent>;   // text-delta | tool-activity | permission-request | turn-complete | error
  interrupt(): Promise<void>;
}
```

- **Datei-Änderungen kommen aus dem chokidar-Watcher** (ground truth), nicht aus Tool-Call-Parsing → identisches Verhalten über alle Backends.
- Adapter: `claude-sdk` (`@anthropic-ai/claude-agent-sdk`, API-Key, `canUseTool` → permission-request) · `claude-cli` (System-`claude -p --output-format stream-json --input-format stream-json --include-partial-messages`, Abo) · `codex` (`@openai/codex-sdk`, Abo + API) · `gemini-cli` (`gemini -p --output-format stream-json --approval-mode auto_edit`) · `grok-cli` (`grok -p`, headless) · `byok` (Vercel AI SDK v6 Tool-Loop mit eigenen workspace-scoped read/write/edit-Tools; deckt alle 4 Anbieter per API-Key).
- Permission-Policy-Default: Auto-Approve für Edits in `<workspace>/site/`, Deny außerhalb, Prompt für Shell/Netz.
- ACP (agentclientprotocol.com) als späterer „Long-Tail"-Adapter vormerken (Gemini & Grok sprechen es nativ).

### Live-Preview

Eigener ~200-Zeilen-Static-Server + chokidar + WebSocket-Reload; Injection-Middleware fügt Reload-Client + Console/Error-Shim in jede Seite ein (Dyad-erprobtes Muster). Panel = sandboxed `<iframe>` auf `127.0.0.1:<random-port>` mit Token; Panel-Tausch links/rechts = CSS-Grid-Order. Shim fängt `window.onerror`/`unhandledrejection`/`console.*` → **„Fehler beheben"-Button** templated den Fehler in einen Chat-Turn.

### Versionierung

Echtes git pro Workspace (Nutzer kann es mit normalem git öffnen; UI sagt nie „git"). Checkpoint pro Agent-Turn (`commit` mit erster Prompt-Zeile; Trailer: Turn-ID, Backend, Session, Kosten). Benannte Versionen = annotated Tags + Anzeigename in der DB. **Restore-als-neuer-Commit** (linear, verlustfrei, kein detached HEAD); dirty state wird vorher auto-checkpointed.

### Deploy-Engine (das Herzstück)

- Transporte: `ssh2-sftp-client` v12 (SFTP) + `basic-ftp` v6 (FTP/FTPS inkl. TLS-Session-Reuse — viele Shared-Hoster verlangen das). rsync nur als erkannter Opt-in-Transport (Windows-Problem).
- **Hash-Manifest-Sync** (Muster von SamKirkland/FTP-Deploy-Action): lokaler Hash-Baum vs. `.wab-manifest.json` auf dem Server → minimale Upload/Delete-Ops. Reihenfolge für Fast-Atomarität: Uploads → Deletes → Manifest zuletzt.
- Manifest speichert die **Commit-SHA** → „Deployed"-Badge in der Timeline; Drift-Erkennung beim Verbinden.
- **Rollback** = alte Version aus git in Temp-Dir materialisieren, Hash-Diff gegen Remote-Manifest, Delta-Upload. Funktioniert auf dem dümmsten Hoster, sekundenschnell bei statischen Seiten.
- Preflight-Verbindungstest + Capability-Probe pro Host; Test-Matrix: Hetzner, IONOS, all-inkl, Strato, Netcup.
- Credentials: `@napi-rs/keyring` → OS-Schlüsselbund (kein bare `safeStorage` — Linux-Plaintext-Falle); Warnung, wenn kein Secret Service vorhanden.

### Sicherheit

`contextIsolation` + Renderer-`sandbox`, IPC-Sender-Validierung, `will-navigate` deny-by-default, `setPermissionRequestHandler`; Preview-Server loopback-only mit Random-Port + Token, `postMessage`-Origin-Checks. (Die Preview rendert KI-generiertes HTML/JS — das ist unsere größte Angriffsfläche.)

## 5. UI / Design

Strikt nach AdminCave-Design-System (github.com/AdminCave/DesignSystem, vollständig extrahiert):
- Dark-mode-first auf Schwarz (`--bg #000`), Light via `data-theme="light"`; monochrom + Hairlines, Blau-Akzent `#4f9dff` (max. eine betonte Aktion pro View)
- Geist / Geist Mono; Mono für Metadaten (Versionen, Zeitstempel, Ports); Pill-Buttons (primary = weiß-auf-schwarz dark); Cards 16px-Radius ohne Schatten im Ruhezustand; aktive Navigation = Gewicht + Unterstrich, nie gefüllte Pill
- Deutsch, informelles Du; keine Emojis in Produkt-Copy, keine Gradients
- Layout v1: Titlebar · Chat-Panel ⟷ Preview-Panel (tauschbar) · Timeline-Sidebar (Checkpoints, Deployed-Badge) · Statusleiste (Backend, Kosten, Deploy-Status)

## 6. Meilensteine

**M0 — Fundament (Setup)**
Monorepo (pnpm), Electron-Shell mit Security-Hardening, React + Design-Tokens aus dem DS-Repo, CI (Lint/Test/Build für Linux/Win/mac), Projekt-Registry.

**M1 — Workspace-Kern**
`packages/versioning` (init, checkpoint, restore, tags) + `packages/preview` (Server, Watcher, Reload, Shim) + Projektanlage mit 2–3 Starter-Templates (statisch, DS-konform). Ergebnis: Projekt anlegen, Dateien von Hand ändern, Preview aktualisiert live, Timeline zeigt Checkpoints.

**M2 — KI-Chat (erste Backends)**
`packages/agents` mit `byok` (Vercel AI SDK, workspace-scoped Tools) und `claude-sdk` (API-Key). Chat-UI mit Streaming, Tool-Activity-Anzeige, Permission-Prompts, Checkpoint pro Turn, „Fehler beheben"-Button. Ergebnis: Webseite per Chat bauen mit API-Key.

**M3 — Deploy-Engine**
`packages/deploy` komplett: SFTP/FTPS, Manifest-Sync, Preflight, Rollback, Keychain, Deploy-UI + Deployed-Badge + Deploy-Historie. Test gegen die Hoster-Matrix. Ergebnis: Knopfdruck-Deploy + Rollback — das Alleinstellungsmerkmal steht.

**M4 — Abo-Backends**
`claude-cli` (Nutzer-Install, Feature-Flag + Hinweis), `codex` (Abo + API), `gemini-cli`, `grok-cli` (experimentell). Backend-Erkennung („Claude Code gefunden, eingeloggt als …"), Onboarding-Deeplinks zu den Vendor-Installern, Remote-Kill-Switch-Config. Parallel (nicht-Code): Genehmigungsanfrage an Anthropic stellen.

**M5 — Release-Politur (v1)**
Deutsches Onboarding, electron-updater, Packaging (deb + AppImage, NSIS, notarisiertes dmg), Fehlerberichte, Docs. Website/Repo-Setup unter AdminCave.

**v1.1 (danach):** Push-to-talk-Voice (Cloud-STT mit Nutzer-Key), Diff-Viewer pro Checkpoint, Netlify/CF-Pages-Targets, ggf. ACP-Adapter.
**Später:** lokales Whisper, Astro-Projekttyp, MSP-Fleet-Ausbau (§9).

## 7. Risiken & Gegenmaßnahmen

| # | Risiko | Gegenmaßnahme |
|---|---|---|
| 1 | Anthropic/Vendor kippt Abo-Pfad | Nur offizielle CLIs spawnen; API-Key-Fundament; Kill-Switch; Genehmigung anfragen; Codex/Gemini als stabile Alternativen |
| 2 | Dyad baut unsere Features nach | Geschwindigkeit beim Deploy-Kern (deren Issue #2636 ist offen, nicht gebaut); DACH/DSGVO-Positionierung, die Dyad nicht besetzt |
| 3 | CLI-Protokoll-Drift (stream-json, Flags) | SDKs mit gepinnten CLI-Versionen bevorzugen; Capability-Detection aus Init-Event; Contract-Tests pro Adapter in CI |
| 4 | Shared-Hosting-Heterogenität | Manifest-Sync + sichere Op-Reihenfolge + Resumability; Preflight-Probe; Hoster-Test-Matrix |
| 5 | Preview rendert KI-Code | iframe-Sandbox, loopback+Token, Origin-Checks, Electron-Hardening |
| 6 | Linux-Desktop-Varianz (Kern-Zielgruppe) | keyring mit Backend-Detection + Warnung; deb + AppImage; CI-Smoke auf GNOME/KDE/Wayland/X11 |
| 7 | Scope-Explosion (daran starben Konkurrenten) | Voice, SSG, Multi-Session, Code-Editor explizit NICHT in v1 |

## 8. Explizit NICHT in v1

Voice (→ v1.1) · lokales Whisper · rsync-Default · „Safe-Swap"/Symlink-Deploys · Netlify/CF Pages · Astro/Build-Pipelines · ACP-Adapter · MCP-Konfigurations-UI · Subagents/Worktrees · In-App-Code-Editor (max. Read-only-Viewer) · Diff-Viewer (nur Datei-Änderungsliste) · Bildgenerierung · Formulare/Backend-Features · i18n über Deutsch+Englisch hinaus.

## 9. Spätere Ausbaustufe: MSP-Fleet (validieren, nicht bauen)

Der Markt-Report sieht die beste Zahlungsbereitschaft bei IT-Dienstleistern, die 10–50 Kundenseiten pflegen (Fleet-Dashboard, KI-Edits übers eigene Abo, Deploy + Rollback pro Kunde, Monitoring). Das bleibt als v2-Kandidat — erst validieren (Interviews), wenn v1 Traktion zeigt.

## 10. Offene Punkte

- [ ] Genehmigungsanfrage an Anthropic formulieren (Abo-Modus, „unless previously approved"-Carve-out)
- [ ] Produktname final? (Arbeitstitel: Web AI Builder)
- [ ] Lizenz/OSS-Frage: offen wie Dyad (Apache + FSL für Pro-Teile) oder closed?
- [ ] Verteilung: GitHub Releases reicht für v1?
- [ ] Vor Launch: Vendor-Terms-Recheck (§3)
- [ ] M5-Packaging: better-sqlite3 sauber für Electron-ABI bauen (@electron/rebuild / electron-builder install-app-deps); Test- vs. GUI-Build trennen (siehe SETUP.md)

## 11. Fortschritt

- [x] **M0 — Fundament**: pnpm-Monorepo, gehärtete Electron-Shell, React-Renderer mit Drei-Panel-Layout, Design-Tokens vendored, CI. Typecheck/Build/Lint grün.
- [x] **M1 — Workspace-Kern**: `versioning` (git-Checkpoints, Restore-als-neuer-Commit, 15 Tests), `preview` (Loopback-Server + Token + Live-Reload + Fehler-Shim, 8 Tests), Projekt-Registry (better-sqlite3, 12 Tests) + 3 statische Starter-Templates. 35 Tests grün.
- [x] **M2 — KI-Chat**: `agents` mit `byok` (Vercel AI SDK v7, sandboxed Datei-Tools, Pfad-Containment inkl. Symlink-Schutz) + `claude-sdk` (17 Tests); Desktop-Integration: Preview-Lebenszyklus, Agent-Event-Streaming, Chat-UI mit Tool-Chips + Permission-Prompt + „Fehler beheben", Checkpoint pro Turn, Timeline mit Wiederherstellen (40 Tests). 80 Tests grün.
  - Offener Naht-Punkt: Permission-Rückkanal — Adapter verweigert fail-safe, Desktop nutzt Generator-`next(decision)`. Sauberer Fix: `resolve`-Callback am `permission-request`-Event in core. Reconcilen in M4 (erst bei Shell-/Netz-Tools tragend). API-Key liegt aktuell nur im Main-Prozess-Speicher → OS-Keychain in M3.
- [x] **M3 — Deploy-Engine**: `deploy`-Paket mit Transport-Abstraktion (SFTP/FTP/FTPS), Hash-Manifest-Sync mit Delta-Upload, Preflight/Capability-Probe, Rollback, Drift-Erkennung — gegen echte In-Process-Server getestet (16 Tests, beide Transporte). Keychain-Migration (`@napi-rs/keyring`, Fallback + Warnung). Desktop: Zielverwaltung, „Verbindung testen", „Veröffentlichen" mit Live-Fortschritt, „Deployed"-Badge in der Timeline, Drift-Warnung, „diese Version deployen" pro Checkpoint, Deploy-Historie. 158 Tests grün (Desktop 102).
- [x] **M4 — Abo-Backends**: vier CLI-Adapter (`claude-cli`, `codex`, `gemini-cli`, `grok-cli`) — spawnen die offizielle, vom Nutzer installierte + eingeloggte Vendor-CLI, kein Token-/Base-URL-Handling (43 Agents-Tests). Permission-Rückkanal sauber rekonziliert (über `requestId` + Generator-Rückgabewert, ohne Core-Änderung). Echte Backend-Erkennung (installiert? eingeloggt?), Onboarding-Deeplinks, fail-safe Remote-Kill-Switch pro Anbieter, Claude-Abo-Feature-Flag + Hinweis/Bestätigung. Abo-Backend als aktives Backend wählbar mit Readiness-Gate im Main-Prozess. 248 Tests grün (Desktop 166).
  - Compliance verifiziert: nur offizielle CLIs, keine Token-/Base-URL-Zuweisungen im Code (nur Kommentare, die die Regel festhalten).
- [ ] **M5 — Release-Politur**
