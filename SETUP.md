# Web AI Builder — Entwickler-Setup

Voraussetzungen: Node ≥ 22, `corepack enable` (aktiviert pnpm). Siehe `PLAN.md` für Architektur und Roadmap.

## Installation

```bash
pnpm install
```

## Skripte (Repo-Root)

| Befehl | Zweck |
|---|---|
| `pnpm dev` | Vite + Electron im Dev-Modus (braucht Display; siehe Hinweis unten) |
| `pnpm typecheck` | TypeScript strict über alle Pakete |
| `pnpm build` | Alle Pakete + Renderer bauen |
| `pnpm lint` | ESLint |
| `pnpm -r test` | Vitest in allen Paketen (System-Node / node-ABI) |
| `pnpm package` | Installer für die aktuelle Plattform bauen (electron-builder) |
| `pnpm package:linux` | Linux-Installer bauen (AppImage + deb) |

## Packaging & Auto-Update (M5)

Installer werden mit **electron-builder** gebaut (Konfiguration: `apps/desktop/electron-builder.yml`). Targets: Linux `AppImage` + `deb`, Windows `nsis`, macOS `dmg`. `pnpm package` baut für die aktuelle Plattform, `pnpm package:linux` gezielt die Linux-Installer. Die CI (`.github/workflows/release.yml`) baut auf Tag-Push `v*` die Installer für alle drei Plattformen und lädt sie samt Auto-Update-Metadaten zu GitHub Releases.

**Auto-Update** (electron-updater) prüft im gepackten Build beim Start und periodisch gegen GitHub Releases (`AdminCave/webaibuilder`), lädt im Hintergrund und meldet „Update bereit" an die UI (Neustart per Klick, sonst beim Beenden). Im Dev (`!app.isPackaged`) ist der Updater ein No-op.

### natives Modul (better-sqlite3) & Electron-ABI — gelöst

Die Projekt-Registry nutzt `better-sqlite3` (natives Modul, V8-/ABI-abhängig). Nach `pnpm install` ist es für **System-Node** gebaut — so laufen die Vitest-Tests headless (`pnpm -r test`). Electron bringt eine **eigene ABI** mit; das Neubauen dafür passiert jetzt **automatisch beim Packen**: electron-builder rebuildet die App-Deps über `npmRebuild` (electron-builder.yml). Der normale install-/test-Pfad bleibt damit unberührt — **kein Postinstall-Rebuild**, Tests laufen weiter unter node-ABI.

- `@napi-rs/keyring` ist ein Node-API-Modul (ABI-stabil) und lädt in Node **und** Electron ohne Neubau; electron-builder verpackt es mit.
- **pnpm-Layout:** electron-builder findet im pnpm-Monorepo die (transitiven) Produktions-Deps der gebundelten Workspace-Pakete nur zuverlässig in einem flachen `node_modules`. Deshalb setzt `pnpm-workspace.yaml` `node-linker: hoisted` (documented electron-builder + pnpm-Fix, siehe electron-builder#6389; in pnpm ≥10.6 gehört die Einstellung in `pnpm-workspace.yaml`, nicht in `.npmrc`). Das ist ABI-neutral: `pnpm install` baut weiter für System-Node, `pnpm -r test` bleibt grün.

**Lokale GUI-Entwicklung** (`pnpm dev` braucht ein Display) mit echtem SQLite braucht die Electron-ABI. Zum manuellen Umschalten dienen zwei Helfer in `apps/desktop`:

```bash
# vor `pnpm dev`: native App-Deps für Electrons ABI bauen
pnpm --filter @webaibuilder/desktop rebuild:electron   # electron-builder install-app-deps

# danach zurück auf System-Node, damit `pnpm -r test` wieder grün ist
pnpm --filter @webaibuilder/desktop rebuild:node        # pnpm rebuild better-sqlite3
```

Wer parallel testen und die GUI fahren will, trennt beides in separate Checkouts/CI-Jobs — beim Packen ist die Trennung ohnehin automatisch. Sollte nach dem Umschalten je eine ABI-Meldung auftauchen (`NODE_MODULE_VERSION`), setzt ein sauberes `pnpm install` den Zustand vollständig auf System-Node zurück.

## Onboarding & Fehlerberichte (M5)

Beim ersten Start zeigt die App ein kurzes deutsches Onboarding (drei Screens). Das Merk-Flag (`hasOnboarded`) liegt in `<userData>/onboarding-state.json`; über **Einstellungen → Einführung erneut zeigen** startest du den Flow neu.

Fehler- und Log-Erfassung ist **rein lokal** (kein Remote-Versand, PLAN §1): ein rotierender Datei-Logger schreibt strukturierte JSON-Zeilen nach `<userData>/logs/app.log` (Größen-Cap + letzte N rotierte Dateien). Erfasst werden `uncaughtException`/`unhandledRejection`, Renderer-Crashes (`render-process-gone`) und gemeldete Renderer-JS-Fehler; secret-förmige Felder (API-Keys, Passwörter, Token) werden vor dem Schreiben entfernt. In der App: **Einstellungen → Fehler & Logs** (Pfad anzeigen, Ordner öffnen, letzte Zeilen kopieren). Beim Debuggen findest du `<userData>` z. B. unter Linux in `~/.config/Web AI Builder/`.

## Headless-Umgebung (ohne Display)

- Tests und `typecheck`/`build` laufen ohne Display.
- Der Electron-Main-Prozess bootet headless (`WAB_SMOKE=1` + `--ozone-platform=headless`); die Fenster-Erzeugung braucht `xvfb-run` (`sudo apt install xvfb`), sonst bricht sie mangels Display ab — das ist umgebungsbedingt, kein Code-Fehler.
