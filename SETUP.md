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
| `pnpm -r test` | Vitest in allen Paketen |

## Bekannter Punkt: natives Modul (better-sqlite3) unter Electron

Die Projekt-Registry nutzt `better-sqlite3` (natives Modul). Nach `pnpm install` ist es für das **System-Node** gebaut — so laufen die Vitest-Tests headless. Electron bringt aber eine **eigene Node-ABI** mit, daher muss das Modul **einmal für Electron neu gebaut werden, bevor die GUI läuft**:

```bash
# vor dem ersten `pnpm dev`:
pnpm --filter @webaibuilder/desktop exec electron-rebuild -f -w better-sqlite3
```

- `@electron/rebuild` wird in M5 (Packaging) als Dev-Abhängigkeit ergänzt; electron-builder ruft beim Bauen `install-app-deps` automatisch auf.
- Nach einem Electron-Rebuild schlägt `pnpm -r test` fehl (ABI passt dann nur zu Electron). Für die Tests danach wieder `pnpm rebuild better-sqlite3` (System-Node) — oder Tests und GUI in getrennten Checkouts/CI-Jobs fahren. Wird in M5 sauber getrennt.

## Headless-Umgebung (ohne Display)

- Tests und `typecheck`/`build` laufen ohne Display.
- Der Electron-Main-Prozess bootet headless (`WAB_SMOKE=1` + `--ozone-platform=headless`); die Fenster-Erzeugung braucht `xvfb-run` (`sudo apt install xvfb`), sonst bricht sie mangels Display ab — das ist umgebungsbedingt, kein Code-Fehler.
