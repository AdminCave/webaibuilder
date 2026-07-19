/**
 * FTP/FTPS transport via basic-ftp v6 (PLAN §4). Supports explicit FTPS
 * (secure: true) including TLS session reuse for the data connection — many
 * shared hosters require this. All paths are absolute POSIX paths.
 */

import { posix } from 'node:path';
import { Readable, Writable } from 'node:stream';

import { Client as FtpClient, FTPError } from 'basic-ftp';

import type { DeployTarget } from '@webaibuilder/core';

import type { DeployCredentials } from './types';
import type { RemoteEntry, Transport } from './transport';

const CONNECT_TIMEOUT_MS = 15_000;

/** FTP response codes for "file/directory not found" (hosters vary here). */
function isNotFound(err: unknown): boolean {
  if (!(err instanceof FTPError)) return false;
  if (err.code === 550 || err.code === 551 || err.code === 450) return true;
  return /no such file|not exist|enoent/i.test(err.message);
}

export class FtpTransport implements Transport {
  readonly kind: 'ftp' | 'ftps';
  readonly tlsSessionReuse: boolean | undefined;

  private readonly client = new FtpClient(CONNECT_TIMEOUT_MS);
  private readonly secure: boolean;

  constructor(
    private readonly target: DeployTarget,
    private readonly credentials: DeployCredentials,
  ) {
    this.kind = target.protocol === 'ftps' ? 'ftps' : 'ftp';
    this.secure = target.protocol === 'ftps';
    // basic-ftp automatically reuses the control connection's TLS session for
    // the data connection (session reuse) — we only report it.
    this.tlsSessionReuse = this.secure ? true : undefined;
  }

  async connect(): Promise<void> {
    await this.client.access({
      host: this.target.host,
      port: this.target.port,
      user: this.target.username,
      password: this.credentials.password,
      secure: this.secure,
      // Shared hosters often use self-signed certificates; verification
      // is up to the caller (the host is explicitly configured by the user).
      secureOptions: this.secure ? { rejectUnauthorized: false } : undefined,
    });
  }

  async disconnect(): Promise<void> {
    this.client.close();
    return Promise.resolve();
  }

  async list(remoteDir: string): Promise<RemoteEntry[]> {
    const items = await this.client.list(remoteDir);
    return items.map((item) => ({
      name: item.name,
      type: item.isDirectory ? 'dir' : item.isFile ? 'file' : 'other',
    }));
  }

  async ensureDir(remoteDir: string): Promise<void> {
    // ensureDir creates recursively AND changes the working directory there;
    // since we use absolute paths everywhere, the cwd side effect is harmless.
    await this.client.ensureDir(remoteDir);
  }

  async removeDir(remoteDir: string): Promise<void> {
    await this.client.removeDir(remoteDir);
  }

  async uploadFile(remotePath: string, data: Buffer): Promise<void> {
    await this.client.uploadFrom(Readable.from(data), remotePath);
  }

  async deleteFile(remotePath: string): Promise<void> {
    // ignoreErrorCodes=true → idempotent (no error if already gone).
    await this.client.remove(remotePath, true);
  }

  async readFile(remotePath: string): Promise<Buffer | null> {
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    });
    try {
      await this.client.downloadTo(sink, remotePath);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
    return Buffer.concat(chunks);
  }

  async exists(remotePath: string): Promise<'file' | 'dir' | false> {
    const dir = posix.dirname(remotePath);
    const base = posix.basename(remotePath);
    let entries: RemoteEntry[];
    try {
      entries = await this.list(dir);
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
    const found = entries.find((entry) => entry.name === base);
    if (!found) return false;
    return found.type === 'dir' ? 'dir' : 'file';
  }

  async rename(fromPath: string, toPath: string): Promise<void> {
    await this.client.rename(fromPath, toPath);
  }

  async writeFile(remotePath: string, data: Buffer): Promise<void> {
    const tmp = `${remotePath}.wabtmp-${process.pid}`;
    await this.uploadFile(tmp, data);
    try {
      await this.deleteFile(remotePath);
      await this.client.rename(tmp, remotePath);
    } catch {
      try {
        await this.deleteFile(tmp);
      } catch {
        // temp may already be gone — does not matter.
      }
      await this.uploadFile(remotePath, data);
    }
  }
}
