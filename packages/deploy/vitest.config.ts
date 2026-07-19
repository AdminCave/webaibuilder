import { defineConfig } from 'vitest/config';

/**
 * Tests of the deploy engine run real in-process servers (ssh2-SFTP + ftp-srv)
 * against temp directories. Loopback handshakes + round-trips need a bit more
 * room than the Vitest default; server setup/teardown runs in the hooks.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
