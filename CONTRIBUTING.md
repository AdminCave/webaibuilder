# Mitmachen bei Web AI Builder

Danke, dass du dir das anschaust. Diese Datei fasst kurz zusammen, wie das Repo aufgebaut ist und worauf du beim Beitragen achtest. Ausführliches zu Architektur und Roadmap steht in [`PLAN.md`](PLAN.md), das Entwickler-Setup in [`SETUP.md`](SETUP.md).

## Monorepo-Layout

pnpm-Workspace, TypeScript. Die Fach-Logik liegt in Electron-freien Paketen, der Electron-Glue nur in der App.

- `apps/desktop` — die Electron-App (main, preload, React-Renderer im AdminCave-Design-System)
- `packages/core` — geteilte Typen (`AgentEvent`, Permission-Policy, Projekt-/Workspace-Typen, IPC-Registry)
- `packages/agents` — die sechs Agent-Adapter (`byok`, `claude-sdk`, `claude-cli`, `codex`, `gemini-cli`, `grok-cli`)
- `packages/preview` — Live-Preview: statischer Server + Watcher + WS-Reload + Fehler-Shim
- `packages/versioning` — echtes git pro Workspace: Checkpoints, Restore-als-neuer-Commit, benannte Versionen
- `packages/deploy` — Deploy-Engine: Hash-Manifest-Sync über SFTP/FTPS, Rollback, Preflight

## Loslegen

```bash
pnpm install       # einmalig
pnpm dev           # App im Dev-Modus (braucht ein Display)
pnpm typecheck     # TypeScript strict über alle Pakete
pnpm test          # Vitest, headless (pnpm -r test)
pnpm lint          # ESLint
pnpm package       # Installer für die aktuelle Plattform
```

Details (native Module, Electron-ABI vs. node-ABI, Headless-Umgebung) stehen in [`SETUP.md`](SETUP.md). Bevor du einen PR aufmachst: `pnpm typecheck && pnpm build && pnpm -r test` müssen grün sein.

## Konventionen

- **TypeScript strict.** Kein `any`, keine stillen Casts. Neue Logik wird typisiert und getestet.
- **Electron-freie Pakete.** `packages/*` importiert **nie** `electron` oder Node-GUI-Spezifika. Alles Electron-/Node-Gebundene lebt in `apps/desktop/src/main` bzw. `preload`. So bleiben die Pakete headless testbar und ein Tauri-Wechsel offen.
- **core-frozen / desktop-additive.** `packages/core` (IPC-Registry, Bridge-Vertrag, `BRIDGE_VERSION`) ist eingefroren. Neue IPC-Kanäle und Bridge-Oberfläche kommen additiv in `apps/desktop/src/shared` (eigene `WAB_DESKTOP_BRIDGE_VERSION` hochzählen). Kanäle folgen `wab:v<version>:<domäne>:<aktion>` und sind voll typisiert.
- **Sicherheit (M0-Posture) halten.** `contextIsolation` + Renderer-`sandbox`, IPC-Sender-Validierung, deny-by-default für Navigation/Permissions. Der Renderer spricht ausschließlich über die typisierte Preload-Bridge — keine neuen Wege drumherum.
- **UI-Copy: Deutsch, informelles Du.** Keine Emojis in der Produkt-Oberfläche, keine Gradients. Strikt AdminCave-Design-System (Hairlines, Geist/Geist Mono, ein Blau-Akzent, Pill-Buttons, monochrom). Metadaten (Ports, Zeitstempel, Versionen) in Mono.
- **Tests headless.** Vitest läuft ohne Display/DOM (node-Umgebung). Reine Logik gehört in `shared`/Pakete und wird dort getestet; Pfade werden injiziert (kein `app.getPath` in testbarer Logik).

## Compliance-Regel für KI-Backends (nicht verhandelbar)

Siehe [`PLAN.md` §3](PLAN.md). Kurz und bindend für jeden Beitrag, der Abo-Backends berührt:

- Die App startet ausschließlich die **offizielle, unveränderte Vendor-CLI**, die der Nutzer selbst installiert und selbst eingeloggt hat.
- **Kein Token-Handling.** Niemals OAuth-/Session-Token der Anbieter lesen, speichern, proxien oder übertragen. Kein „Login mit …" in unserer App.
- **Kein Backend-Umleiten** (`ANTHROPIC_BASE_URL` o. Ä.), kein Harness-Spoofing, keine Browser-Automation von Chat-UIs.
- Der API-Key-Modus bleibt Fundament und Fallback. Abo-Pfade sitzen hinter Erkennung + Remote-Kill-Switch (+ Bestätigung bei Claude).

PRs, die diese Regel verletzen (z. B. Token-Persistenz oder Base-URL-Zuweisung einführen), werden nicht angenommen.

## Fehlerberichte

Fehler-/Log-Erfassung ist **rein lokal** (rotierende Datei unter `<userData>/logs/`). Kein Remote-Versand, kein Endpunkt — das gehört zur Local-first-Positionierung (PLAN §1). Wer Kontext ins Log schreibt: der Logger scrubbt bekannte secret-förmige Felder, aber logge trotzdem nie bewusst Zugangsdaten.
