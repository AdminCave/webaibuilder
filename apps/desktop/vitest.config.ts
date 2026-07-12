import { defineConfig } from 'vitest/config';

/**
 * Headless-Tests für den Main-Prozess (Node, ohne Electron). Die Registry
 * bekommt DB-Pfad/Workspace/Vorlagen injiziert — `app.getPath('userData')`
 * wird nur zur App-Laufzeit verdrahtet (src/main/paths.ts).
 */
export default defineConfig({
  test: {
    // Headless-Tests: Main-Prozess-Registry + reine shared-Logik (Reducer,
    // Permission-Automat, Fehler-Templating, Settings). Kein Electron/DOM nötig.
    include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts'],
    environment: 'node',
  },
});
