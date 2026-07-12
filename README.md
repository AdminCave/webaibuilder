<!-- AdminCave-Logo: assets/logo im DesignSystem-Repo (github.com/AdminCave/DesignSystem). -->
<!-- ![AdminCave](https://raw.githubusercontent.com/AdminCave/DesignSystem/main/assets/logo.svg) -->

# Web AI Builder

**Deine Webseite. Deine KI. Dein Webspace.**

Web AI Builder ist ein Desktop-Client, mit dem du per KI-Chat Webseiten baust und sie **per Knopfdruck auf deinen eigenen Webspace deployst** — inklusive Rollback. Alles läuft lokal auf deinem Rechner: die KI über deine eigenen Abos oder API-Keys, die Seite auf deinem eigenen Hosting. Keine Cloud dazwischen, kein Zwischenspeicher, keine fremden Server.

Ein AdminCave-Projekt. Deutsch-first, DSGVO- und Local-first.

> Status: v1 (M0–M5 fertig). Siehe [Status / Roadmap](#status--roadmap).

<!-- TODO(Screenshot): Drei-Panel-Ansicht — Chat ⟷ Live-Vorschau ⟷ Timeline — hier einfügen. -->
<!-- ![Web AI Builder — Screenshot](docs/screenshot.png) -->
_Screenshot folgt._

## Warum

Für die DACH-„IT-Person, die der Verein oder die Familie fragt": klassisches Shared Hosting (IONOS, Strato, all-inkl, Netcup, Hetzner), eine kleine Seite, wenig Lust auf Build-Pipelines und Cloud-Abos. Web AI Builder kombiniert polierte Desktop-UX, KI über dein eigenes Abo und — das Herzstück — SFTP-Deploy mit Rollback. Diese Kombination gibt es sonst nirgends.

## Dein Modell: eigenes Abo ODER eigener API-Key

Du entscheidest, wie die KI läuft, und du kannst beide Wege mischen:

- **Eigener API-Key** — du hinterlegst einen Schlüssel von Anthropic, OpenAI, Google oder xAI. Der Key liegt im **Systemschlüsselbund deines Betriebssystems**, nie im Klartext auf der Platte.
- **Eigenes Abo per CLI** — nutzt dein bestehendes Abo (Claude, Codex, Gemini, Grok) über die **offizielle CLI des Anbieters**, die du selbst installierst und in die du dich selbst einloggst.

**Compliance-Hinweis (wichtig):** Diese App liest, speichert, proxied oder überträgt **niemals** deine Anbieter-Token. Es gibt kein „Login mit Claude/ChatGPT" in dieser App — beim Abo-Weg läuft der Login ausschließlich in der offiziellen CLI des Anbieters. Web AI Builder startet nur, was du selbst eingerichtet und eingeloggt hast, und leitet keine Backends um. Der API-Key-Modus ist immer das Fundament und der Fallback.

## Features

- **KI-Chat** — beschreib, was du willst; die KI ändert die Dateien deiner Seite. Tool-Aktivität, Permission-Prompts und ein „Fehler beheben"-Knopf inklusive.
- **Live-Vorschau** — jede Änderung erscheint sofort in einer sandboxed Vorschau (loopback-Server, Token-geschützt). Chat- und Vorschau-Panel sind tauschbar.
- **git-Checkpoints** — pro Chat-Turn ein Checkpoint (echtes git im Hintergrund). Wiederherstellen als neuer Commit — linear, verlustfrei, kein Frickeln.
- **SFTP/FTP-Deploy mit Rollback** — nur geänderte Dateien werden hochgeladen (Hash-Manifest-Sync). Der deployte Stand wird gemerkt; auf eine frühere Version rollst du sekundenschnell zurück.

## Unterstützte KI-Backends

| Weg | Backend | Anbieter | Hinweis |
|---|---|---|---|
| API-Key | `byok` | Anthropic, OpenAI, Google, xAI | Eigener Schlüssel, Modell frei wählbar |
| API-Key | `claude-sdk` | Anthropic | Claude Agent SDK mit API-Key |
| Abo (eigene CLI) | `claude-cli` | Claude | Hinter Feature-Flag + In-App-Hinweis |
| Abo (eigene CLI) | `codex` | OpenAI Codex | Abo **und** API-Key |
| Abo (eigene CLI) | `gemini-cli` | Google Gemini | Per ToS über die CLI erlaubt |
| Abo (eigene CLI) | `grok-cli` | xAI Grok | **experimentell** |

Bei jedem Abo-Backend erkennt die App, ob die CLI installiert und eingeloggt ist, und verlinkt sonst die offizielle Installations-/Anmeldeanleitung. Ein Remote-Kill-Switch pro Anbieter erlaubt es, einen Abo-Pfad über Nacht zu deaktivieren, falls ein Anbieter seine Regeln ändert.

## Unterstützte Deploy-Ziele

Klassisches Shared Hosting per **SFTP**, **FTP** und **FTPS** (FTP über TLS, inkl. Session-Reuse, den viele Hoster verlangen). Getestet gegen die Hoster-Matrix: Hetzner, IONOS, all-inkl, Strato, Netcup. Zugangsdaten liegen im Systemschlüsselbund. Deploy-Ziele richtest du **pro Projekt** ein.

## Architektur

Electron-Shell mit gehärtetem Renderer (contextIsolation + Sandbox, typisierte Preload-Bridge). Die Fach-Logik steckt in Electron-freien TypeScript-Paketen — das hält einen späteren Tauri-Wechsel und Headless-Ableger offen.

- [`apps/desktop`](apps/desktop) — Electron-App (main, preload, React-Renderer im AdminCave-Design-System)
- [`packages/core`](packages/core) — geteilte Typen, `AgentEvent`, Permission-Policy, IPC-Registry
- [`packages/agents`](packages/agents) — die sechs Agent-Adapter (byok + fünf Vendor-Pfade)
- [`packages/preview`](packages/preview) — Live-Preview-Server + Watcher + Reload + Fehler-Shim
- [`packages/versioning`](packages/versioning) — git pro Workspace, Checkpoints, Restore
- [`packages/deploy`](packages/deploy) — Hash-Manifest-Sync über SFTP/FTPS, Rollback, Preflight

Mehr Hintergrund: [`PLAN.md`](PLAN.md).

## Datenschutz & Fehlerberichte

Local-first, kein Telemetrie-Versand. Läuft etwas schief, landen die Details in einem **lokalen, rotierenden Log** unter `<userData>/logs/` auf deinem Rechner. Über **Einstellungen → Fehler & Logs** öffnest du den Ordner oder kopierst die letzten Zeilen — es wird **nichts an einen Server gesendet**. Bekannte secret-förmige Felder (API-Keys, Passwörter, Token) werden vor dem Schreiben aus den Logs entfernt.

## Installation & Entwicklung

Voraussetzungen und alle Skripte stehen in [`SETUP.md`](SETUP.md). Kurz:

```bash
pnpm install
pnpm dev        # App im Dev-Modus (braucht ein Display)
pnpm test       # Tests (headless)
pnpm package    # Installer für die aktuelle Plattform
```

Installer werden mit electron-builder gebaut (Linux `AppImage` + `deb`, Windows `nsis`, macOS `dmg`), Auto-Update über GitHub Releases.

## Status / Roadmap

**v1 — fertig:**

- **M0** Fundament: gehärtete Electron-Shell, React-Renderer, Design-Tokens, CI
- **M1** Workspace-Kern: git-Checkpoints, Live-Preview, Starter-Vorlagen
- **M2** KI-Chat: `byok` + `claude-sdk`, Streaming, Tool-Activity, „Fehler beheben"
- **M3** Deploy-Engine: SFTP/FTPS, Manifest-Sync, Rollback, Drift-Erkennung, Keychain
- **M4** Abo-Backends: `claude-cli`, `codex`, `gemini-cli`, `grok-cli`, Erkennung, Kill-Switch
- **M5** Release-Politur: Onboarding, Auto-Update, Packaging, Fehlerberichte, Docs

**v1.1 — als Nächstes:** Push-to-talk-Voice (Cloud-STT mit eigenem Key), Diff-Viewer pro Checkpoint, Netlify-/Cloudflare-Pages-Targets.

**Später:** lokales Whisper, Astro-Projekttyp, MSP-Fleet-Ausbau.

## Lizenz

**Noch offen (TBD).** Die Lizenz-/OSS-Frage ist eine bewusste Entscheidung des Projekt-Owners und noch nicht getroffen — offen (z. B. Apache 2.0, ggf. mit FSL für spätere Pro-Teile wie bei Dyad) oder closed. Bis dahin liegt **keine** `LICENSE`-Datei bei; alle Rechte vorbehalten.

<!-- TODO(LICENSE): Lizenz-Entscheidung durch den Owner treffen und LICENSE-Datei ergänzen (PLAN.md §10). -->
