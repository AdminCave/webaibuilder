/**
 * SFTP transport via ssh2-sftp-client v12 (PLAN §4, primary transport for
 * the admin target audience). All paths are absolute POSIX paths.
 */

import SftpClient from 'ssh2-sftp-client';

import type { DeployTarget } from '@webaibuilder/core';

import type { DeployCredentials } from './types';
import type { RemoteEntry, Transport } from './transport';

/** Timeout until "ready" — deliberately low so errors surface quickly. */
const READY_TIMEOUT_MS = 15_000;

export class SftpTransport implements Transport {
  readonly kind = 'sftp' as const;
  readonly tlsSessionReuse = undefined;

  private readonly client = new SftpClient('wab-deploy');

  constructor(
    private readonly target: DeployTarget,
    private readonly credentials: DeployCredentials,
  ) {}

  async connect(): Promise<void> {
    await this.client.connect({
      host: this.target.host,
      port: this.target.port,
      username: this.target.username,
      password: this.credentials.password,
      privateKey: this.credentials.privateKey,
      passphrase: this.credentials.passphrase,
      readyTimeout: READY_TIMEOUT_MS,
    });
  }

  async disconnect(): Promise<void> {
    try {
      await this.client.end();
    } catch {
      // Connection may already be closed — not a hard error during cleanup.
    }
  }

  async list(remoteDir: string): Promise<RemoteEntry[]> {
    const items = await this.client.list(remoteDir);
    return items.map((item) => ({
      name: item.name,
      type: item.type === 'd' ? 'dir' : item.type === '-' ? 'file' : 'other',
    }));
  }

  async ensureDir(remoteDir: string): Promise<void> {
    await this.client.mkdir(remoteDir, true);
  }

  async removeDir(remoteDir: string): Promise<void> {
    await this.client.rmdir(remoteDir, true);
  }

  async uploadFile(remotePath: string, data: Buffer): Promise<void> {
    await this.client.put(data, remotePath);
  }

  async deleteFile(remotePath: string): Promise<void> {
    // notFoundOK=true → idempotent; deleting again is not an error.
    await this.client.delete(remotePath, true);
  }

  async readFile(remotePath: string): Promise<Buffer | null> {
    const type = await this.client.exists(remotePath);
    if (type !== '-') return null;
    return this.client.get(remotePath);
  }

  async exists(remotePath: string): Promise<'file' | 'dir' | false> {
    const type = await this.client.exists(remotePath);
    if (type === 'd') return 'dir';
    if (type === '-' || type === 'l') return 'file';
    return false;
  }

  async rename(fromPath: string, toPath: string): Promise<void> {
    await this.client.rename(fromPath, toPath);
  }

  async writeFile(remotePath: string, data: Buffer): Promise<void> {
    // Fast-atomic: upload temp first, remove the old target, then rename.
    // Falls back to a direct upload if the host refuses rename.
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
