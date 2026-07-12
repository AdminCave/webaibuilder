/**
 * In-Process-FTP-Server (ftp-srv) für die Tests — bildet "den Remote-Host" auf
 * ein Temp-Verzeichnis ab. Ein Recording-FileSystem zählt jeden STOR (Write),
 * damit die Delta-Upload-Asserts greifen. Kein TLS (Plain-FTP) — der Transport-
 * Code ist für FTPS identisch, nur mit `secure: true`.
 */

import net from 'node:net';

import { FileSystem, FtpSrv } from 'ftp-srv';

export const FTP_USER = 'deployer';
export const FTP_PASS = 'geheim-123';

export interface TestFtpServer {
  port: number;
  writes: string[];
  resetWrites(): void;
  close(): Promise<void>;
}

/** No-op-Logger, damit ftp-srv die Testausgabe nicht flutet. */
function silentLog(): unknown {
  const log = {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: () => log,
  };
  return log;
}

function getFreePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = net.createServer();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => res(port));
    });
  });
}

/** Startet den Test-FTP-Server; `rootDir` ist die Wurzel des virtuellen Dateisystems. */
export async function startFtpServer(rootDir: string): Promise<TestFtpServer> {
  const port = await getFreePort();
  const writes: string[] = [];

  const server = new FtpSrv({
    url: `ftp://127.0.0.1:${port}`,
    pasv_url: '127.0.0.1',
    anonymous: false,
    log: silentLog(),
  });

  server.on('login', (data, resolveLogin, rejectLogin) => {
    if (data.username !== FTP_USER || data.password !== FTP_PASS) {
      rejectLogin(new Error('Falsche Zugangsdaten'));
      return;
    }
    // Recording-FileSystem: jeder Upload (STOR) landet in `writes`.
    class RecordingFileSystem extends FileSystem {
      override write(fileName: string, options?: { append?: boolean; start?: number }): unknown {
        const result = super.write(fileName, options) as { clientPath?: string };
        writes.push(result.clientPath ?? fileName);
        return result;
      }
    }
    resolveLogin({ fs: new RecordingFileSystem(data.connection, { root: rootDir, cwd: '/' }) });
  });

  await server.listen();

  return {
    port,
    writes,
    resetWrites: () => {
      writes.length = 0;
    },
    close: () => Promise.resolve(server.close()),
  };
}
