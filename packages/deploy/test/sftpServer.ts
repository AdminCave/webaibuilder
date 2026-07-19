/**
 * In-process SFTP server (ssh2) for the tests — maps "the remote host" onto
 * a temp directory. Implements enough of the SFTP protocol for
 * ssh2-sftp-client to run real round-trips (OPEN/READ/WRITE/CLOSE,
 * OPENDIR/READDIR, LSTAT/STAT/FSTAT, REALPATH, MKDIR/RMDIR/REMOVE/RENAME).
 *
 * Additionally, the server counts every file opened for writing (`writes`)
 * so the delta-upload asserts can check that only changed files were
 * actually uploaded.
 */

import {
  mkdir,
  open,
  readdir,
  rename,
  rmdir,
  stat,
  lstat,
  unlink,
} from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { join, resolve, sep, posix } from 'node:path';

import { Server, utils } from 'ssh2';
import type { Attributes, FileEntry, SFTPWrapper } from 'ssh2';

const { OPEN_MODE: _OPEN_MODE, STATUS_CODE, flagsToString } = utils.sftp;
void _OPEN_MODE;

export const SFTP_USER = 'deployer';
export const SFTP_PASS = 'secret-123';

export interface TestSftpServer {
  port: number;
  /** SFTP paths that were opened for writing during the current window. */
  writes: string[];
  resetWrites(): void;
  close(): Promise<void>;
}

type Handle =
  | { kind: 'file'; fh: FileHandle }
  | { kind: 'dir'; localPath: string; read: boolean };

function statToAttrs(st: Stats): Attributes {
  return {
    mode: st.mode,
    uid: st.uid,
    gid: st.gid,
    size: st.size,
    atime: Math.floor(st.atimeMs / 1000),
    mtime: Math.floor(st.mtimeMs / 1000),
  };
}

function longname(name: string, st: Stats): string {
  const type = st.isDirectory() ? 'd' : '-';
  // The client reads the type from longname[0] and permissions from [1..10).
  return `${type}rwxr-xr-x 1 0 0 ${st.size} Jan 01 00:00 ${name}`;
}

function installHandlers(sftp: SFTPWrapper, rootDir: string, onWrite: (p: string) => void): void {
  const rootResolved = resolve(rootDir);
  const handles = new Map<number, Handle>();
  let seq = 0;

  const makeHandle = (state: Handle): Buffer => {
    const id = seq++;
    handles.set(id, state);
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(id, 0);
    return buf;
  };
  const getHandle = (buf: Buffer): Handle | undefined => handles.get(buf.readUInt32BE(0));
  const delHandle = (buf: Buffer): void => void handles.delete(buf.readUInt32BE(0));

  const toLocal = (p: string): string => {
    const rel = posix.normalize(`/${p}`).replace(/^\/+/, '');
    const abs = resolve(rootResolved, rel);
    if (abs !== rootResolved && !abs.startsWith(rootResolved + sep)) {
      throw new Error('path traversal blocked');
    }
    return abs;
  };

  sftp.on('REALPATH', (reqid, p) => {
    let cp = p.startsWith('/') ? p : `/${p}`;
    cp = posix.normalize(cp);
    if (cp.length > 1 && cp.endsWith('/')) cp = cp.slice(0, -1);
    sftp.name(reqid, [
      { filename: cp, longname: cp, attrs: { mode: 0o40755, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 } },
    ]);
  });

  const onStat = (follow: boolean) => (reqid: number, p: string): void => {
    let local: string;
    try {
      local = toLocal(p);
    } catch {
      sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
      return;
    }
    (follow ? stat(local) : lstat(local))
      .then((st) => sftp.attrs(reqid, statToAttrs(st)))
      .catch(() => sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE));
  };
  sftp.on('STAT', onStat(true));
  sftp.on('LSTAT', onStat(false));

  sftp.on('FSTAT', (reqid, handle) => {
    const h = getHandle(handle);
    if (!h || h.kind !== 'file') return sftp.status(reqid, STATUS_CODE.FAILURE);
    h.fh
      .stat()
      .then((st) => sftp.attrs(reqid, statToAttrs(st)))
      .catch(() => sftp.status(reqid, STATUS_CODE.FAILURE));
  });

  sftp.on('OPEN', (reqid, filename, flags) => {
    let local: string;
    try {
      local = toLocal(filename);
    } catch {
      return sftp.status(reqid, STATUS_CODE.FAILURE);
    }
    const flagStr = flagsToString(flags) || 'r';
    if (/[wa+]/.test(flagStr)) onWrite(filename);
    open(local, flagStr)
      .then((fh) => sftp.handle(reqid, makeHandle({ kind: 'file', fh })))
      .catch((err: NodeJS.ErrnoException) =>
        sftp.status(reqid, err.code === 'ENOENT' ? STATUS_CODE.NO_SUCH_FILE : STATUS_CODE.FAILURE),
      );
  });

  sftp.on('READ', (reqid, handle, offset, length) => {
    const h = getHandle(handle);
    if (!h || h.kind !== 'file') return sftp.status(reqid, STATUS_CODE.FAILURE);
    const buf = Buffer.alloc(length);
    h.fh
      .read(buf, 0, length, offset)
      .then(({ bytesRead }) => {
        if (bytesRead === 0) sftp.status(reqid, STATUS_CODE.EOF);
        else sftp.data(reqid, buf.subarray(0, bytesRead));
      })
      .catch(() => sftp.status(reqid, STATUS_CODE.FAILURE));
  });

  sftp.on('WRITE', (reqid, handle, offset, data) => {
    const h = getHandle(handle);
    if (!h || h.kind !== 'file') return sftp.status(reqid, STATUS_CODE.FAILURE);
    h.fh
      .write(data, 0, data.length, offset)
      .then(() => sftp.status(reqid, STATUS_CODE.OK))
      .catch(() => sftp.status(reqid, STATUS_CODE.FAILURE));
  });

  sftp.on('CLOSE', (reqid, handle) => {
    const h = getHandle(handle);
    delHandle(handle);
    if (h && h.kind === 'file') {
      h.fh.close().finally(() => sftp.status(reqid, STATUS_CODE.OK));
    } else {
      sftp.status(reqid, STATUS_CODE.OK);
    }
  });

  sftp.on('OPENDIR', (reqid, p) => {
    let local: string;
    try {
      local = toLocal(p);
    } catch {
      return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
    }
    stat(local)
      .then((st) => {
        if (!st.isDirectory()) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
        sftp.handle(reqid, makeHandle({ kind: 'dir', localPath: local, read: false }));
      })
      .catch(() => sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE));
  });

  sftp.on('READDIR', (reqid, handle) => {
    const h = getHandle(handle);
    if (!h || h.kind !== 'dir') return sftp.status(reqid, STATUS_CODE.FAILURE);
    if (h.read) return sftp.status(reqid, STATUS_CODE.EOF);
    readdir(h.localPath, { withFileTypes: true })
      .then(async (dirents) => {
        const names: FileEntry[] = [];
        for (const d of dirents) {
          const st = await lstat(join(h.localPath, d.name));
          names.push({ filename: d.name, longname: longname(d.name, st), attrs: statToAttrs(st) });
        }
        h.read = true;
        sftp.name(reqid, names);
      })
      .catch(() => sftp.status(reqid, STATUS_CODE.FAILURE));
  });

  sftp.on('MKDIR', (reqid, p) => {
    mkdir(toLocal(p))
      .then(() => sftp.status(reqid, STATUS_CODE.OK))
      .catch((err: NodeJS.ErrnoException) =>
        sftp.status(reqid, err.code === 'EEXIST' ? STATUS_CODE.OK : STATUS_CODE.FAILURE),
      );
  });

  sftp.on('RMDIR', (reqid, p) => {
    rmdir(toLocal(p))
      .then(() => sftp.status(reqid, STATUS_CODE.OK))
      .catch(() => sftp.status(reqid, STATUS_CODE.FAILURE));
  });

  sftp.on('REMOVE', (reqid, p) => {
    unlink(toLocal(p))
      .then(() => sftp.status(reqid, STATUS_CODE.OK))
      .catch((err: NodeJS.ErrnoException) =>
        sftp.status(reqid, err.code === 'ENOENT' ? STATUS_CODE.NO_SUCH_FILE : STATUS_CODE.FAILURE),
      );
  });

  sftp.on('RENAME', (reqid, oldPath, newPath) => {
    rename(toLocal(oldPath), toLocal(newPath))
      .then(() => sftp.status(reqid, STATUS_CODE.OK))
      .catch(() => sftp.status(reqid, STATUS_CODE.FAILURE));
  });

  sftp.on('SETSTAT', (reqid) => sftp.status(reqid, STATUS_CODE.OK));
  sftp.on('FSETSTAT', (reqid) => sftp.status(reqid, STATUS_CODE.OK));
}

/** Starts the test SFTP server on a random loopback port. */
export async function startSftpServer(rootDir: string): Promise<TestSftpServer> {
  const hostKey = utils.generateKeyPairSync('ed25519').private;
  const writes: string[] = [];

  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === SFTP_USER && ctx.password === SFTP_PASS) {
        ctx.accept();
      } else if (ctx.method === 'none') {
        ctx.reject(['password']);
      } else {
        ctx.reject();
      }
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('sftp', (acceptSftp) => {
          const sftp = acceptSftp();
          installHandlers(sftp, rootDir, (p) => writes.push(p));
        });
      });
    });
    client.on('error', () => {
      // Connection drops during cleanup are not a test failure.
    });
  });

  const port: number = await new Promise((resolvePort, rejectPort) => {
    server.on('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolvePort(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });

  return {
    port,
    writes,
    resetWrites: () => {
      writes.length = 0;
    },
    close: () =>
      new Promise<void>((res) => {
        server.close(() => res());
      }),
  };
}
