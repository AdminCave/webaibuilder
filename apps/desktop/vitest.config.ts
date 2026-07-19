import { defineConfig } from 'vitest/config';

/**
 * Headless tests for the main process (Node, without Electron). The registry
 * gets DB path/workspace/templates injected — `app.getPath('userData')` is
 * only wired at app runtime (src/main/paths.ts).
 */
export default defineConfig({
  test: {
    // Headless tests: main-process registry + pure shared logic (reducer,
    // permission machine, error templating, settings). No Electron/DOM needed.
    include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts'],
    environment: 'node',
  },
});
