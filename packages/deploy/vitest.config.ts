import { defineConfig } from 'vitest/config';

/**
 * Tests der Deploy-Engine fahren echte In-Process-Server (ssh2-SFTP + ftp-srv)
 * gegen Temp-Verzeichnisse. Loopback-Handshakes + Round-Trips brauchen etwas
 * mehr Luft als der Vitest-Default; Server-Setup/Teardown läuft in den Hooks.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
