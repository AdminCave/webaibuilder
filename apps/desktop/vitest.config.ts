import { defineConfig } from 'vitest/config';

/**
 * Headless-Tests für den Main-Prozess (Node, ohne Electron). Die Registry
 * bekommt DB-Pfad/Workspace/Vorlagen injiziert — `app.getPath('userData')`
 * wird nur zur App-Laufzeit verdrahtet (src/main/paths.ts).
 */
export default defineConfig({
  test: {
    include: ['src/main/**/*.test.ts'],
    environment: 'node',
  },
});
