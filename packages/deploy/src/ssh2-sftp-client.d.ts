/**
 * Minimal ambient types for `ssh2-sftp-client` v12 — the package ships no
 * `.d.ts` of its own and there is no `@types/ssh2-sftp-client`. Only the
 * methods the deploy engine actually uses (kept narrow so there is no
 * misleading full promise of the client API).
 */
declare module 'ssh2-sftp-client' {
  export interface SftpConnectOptions {
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    /** Private key (PEM) for key auth. */
    privateKey?: Buffer | string;
    passphrase?: string;
    /** Timeout (ms) until "ready"; we set it low for fast failure. */
    readyTimeout?: number;
    retries?: number;
    /** ssh2 algorithms etc. — not typed, but passed through. */
    [key: string]: unknown;
  }

  export interface SftpFileInfo {
    /** 'd' directory, '-' file, 'l' symlink. */
    type: 'd' | '-' | 'l';
    name: string;
    size: number;
    modifyTime: number;
    accessTime: number;
  }

  export interface SftpStats {
    isDirectory: boolean;
    isFile: boolean;
    isSymbolicLink: boolean;
    size: number;
    modifyTime: number;
    accessTime: number;
    mode: number;
  }

  export default class SftpClient {
    constructor(name?: string);
    connect(config: SftpConnectOptions): Promise<unknown>;
    list(remotePath: string): Promise<SftpFileInfo[]>;
    exists(remotePath: string): Promise<false | 'd' | '-' | 'l'>;
    stat(remotePath: string): Promise<SftpStats>;
    mkdir(remotePath: string, recursive?: boolean): Promise<string>;
    rmdir(remotePath: string, recursive?: boolean): Promise<string>;
    put(
      input: Buffer | string | NodeJS.ReadableStream,
      remotePath: string,
      options?: unknown,
    ): Promise<string>;
    /** Without `dst`, `get` returns the content as a Buffer. */
    get(remotePath: string): Promise<Buffer>;
    delete(remotePath: string, notFoundOK?: boolean): Promise<string>;
    rename(fromPath: string, toPath: string): Promise<string>;
    posixRename(fromPath: string, toPath: string): Promise<string>;
    end(): Promise<boolean>;
  }
}
