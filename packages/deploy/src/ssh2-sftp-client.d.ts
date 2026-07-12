/**
 * Minimale Ambient-Typen für `ssh2-sftp-client` v12 — das Paket liefert keine
 * eigenen `.d.ts` und es gibt kein `@types/ssh2-sftp-client`. Hier nur die
 * Methoden, die die Deploy-Engine tatsächlich benutzt (schmal gehalten, damit
 * es kein irreführendes Vollversprechen der Client-API gibt).
 */
declare module 'ssh2-sftp-client' {
  export interface SftpConnectOptions {
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    /** Private Key (PEM) für Key-Auth. */
    privateKey?: Buffer | string;
    passphrase?: string;
    /** Timeout (ms) bis "ready"; wir setzen ihn niedrig für schnelles Failen. */
    readyTimeout?: number;
    retries?: number;
    /** ssh2-Algorithmen etc. — nicht typisiert, aber durchgereicht. */
    [key: string]: unknown;
  }

  export interface SftpFileInfo {
    /** 'd' Verzeichnis, '-' Datei, 'l' Symlink. */
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
    /** Ohne `dst` liefert `get` den Inhalt als Buffer zurück. */
    get(remotePath: string): Promise<Buffer>;
    delete(remotePath: string, notFoundOK?: boolean): Promise<string>;
    rename(fromPath: string, toPath: string): Promise<string>;
    posixRename(fromPath: string, toPath: string): Promise<string>;
    end(): Promise<boolean>;
  }
}
