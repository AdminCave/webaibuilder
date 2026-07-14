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

### App im Dev-Modus starten (mit Display)

```bash
pnpm install                                          # nur beim ersten Mal / nach Änderungen
pnpm --filter @webaibuilder/desktop rebuild:electron  # better-sqlite3 auf Electron-ABI bauen
pnpm dev                                              # Vite + Electron

# Wenn du danach wieder Tests fahren willst:
pnpm --filter @webaibuilder/desktop rebuild:node      # better-sqlite3 zurück auf node-ABI
```

### natives Modul (better-sqlite3) & Electron-ABI

Nur **ein** Modul ist ABI-empfindlich:

- **`better-sqlite3`** (Projekt-Registry) ist NAN-basiert — die kompilierte `.node`-Datei muss zur **ABI der Laufzeit** passen. Node 22 und Electron 43 haben unterschiedliche ABIs (127 vs. 148), dieselbe Binärdatei läuft **nicht** in beiden. Deshalb der Toggle: `rebuild:electron` vor `pnpm dev`/`package`, `rebuild:node` vor `pnpm -r test`. Beide Skripte rufen `scripts/rebuild-native.mjs` auf, das better-sqlite3 gezielt (und nur dieses Modul) mit node-gyp neu baut — plattformübergreifend, ohne den kaputten `install-app-deps`-Pfad (der an der optionalen ssh2-Abhängigkeit `cpu-features` scheitert).
- **`@napi-rs/keyring`** ist dagegen **N-API** (ABI-stabil) und läuft in Node **und** Electron ohne Neubau.

Nach `pnpm install` ist better-sqlite3 für **System-Node** gebaut, also laufen die Vitest-Tests direkt. Wer die App starten will, schaltet einmal mit `rebuild:electron` um; wer danach testet, mit `rebuild:node` zurück. Kommt je eine `NODE_MODULE_VERSION`-Meldung, sagt sie dir genau, welche ABI erwartet wird — dann das passende `rebuild:*` laufen lassen.

**Packaging:** `pnpm package` baut better-sqlite3 vorab für Electron (`rebuild:electron`) und packt dann mit `npmRebuild: false` — electron-builder baut also **nichts** nativ neu (und stolpert nicht über `cpu-features`), sondern bündelt die bereits passenden Binärdateien. Voraussetzung dafür, dass electron-builder im pnpm-Monorepo alle Produktions-Deps findet, ist `nodeLinker: hoisted` in `pnpm-workspace.yaml` (flaches `node_modules`; documented pnpm-Fix, electron-builder#6389).

### „Error: Electron uninstall" beim ersten `pnpm dev`

electron-vite findet die Electron-Binary nicht — sie wurde beim `pnpm install` nicht heruntergeladen (pnpm überspringt Build-Skripte teils bei bestehendem `node_modules`). Einmal nachholen:

```bash
node node_modules/electron/install.js      # lädt die Electron-Binary
# oder:  pnpm rebuild electron
```

Danach `pnpm dev` erneut. Ein wirklich frischer `pnpm install` (bzw. `--frozen-lockfile` in CI) lädt die Binary selbst, weil `electron` in `allowBuilds` freigegeben ist.

## Onboarding & Fehlerberichte (M5)

Beim ersten Start zeigt die App ein kurzes deutsches Onboarding (drei Screens). Das Merk-Flag (`hasOnboarded`) liegt in `<userData>/onboarding-state.json`; über **Einstellungen → Einführung erneut zeigen** startest du den Flow neu.

Fehler- und Log-Erfassung ist **rein lokal** (kein Remote-Versand, PLAN §1): ein rotierender Datei-Logger schreibt strukturierte JSON-Zeilen nach `<userData>/logs/app.log` (Größen-Cap + letzte N rotierte Dateien). Erfasst werden `uncaughtException`/`unhandledRejection`, Renderer-Crashes (`render-process-gone`) und gemeldete Renderer-JS-Fehler; secret-förmige Felder (API-Keys, Passwörter, Token) werden vor dem Schreiben entfernt. In der App: **Einstellungen → Fehler & Logs** (Pfad anzeigen, Ordner öffnen, letzte Zeilen kopieren). Beim Debuggen findest du `<userData>` z. B. unter Linux in `~/.config/Web AI Builder/`.

## Headless-Umgebung (ohne Display)

- Tests und `typecheck`/`build` laufen ohne Display.
- Der Electron-Main-Prozess bootet headless (`WAB_SMOKE=1` + `--ozone-platform=headless`); die Fenster-Erzeugung braucht `xvfb-run` (`sudo apt install xvfb`), sonst bricht sie mangels Display ab — das ist umgebungsbedingt, kein Code-Fehler.
