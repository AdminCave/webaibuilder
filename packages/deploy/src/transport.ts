/**
 * Transport abstraction: a narrow interface behind which SFTP
 * (ssh2-sftp-client) and FTP/FTPS (basic-ftp) are interchangeable (PLAN §4).
 * The sync engine only knows this interface. rsync is NOT included in M3.
 */

// TODO(v1.1): rsync transport as a detected opt-in (Windows issues,
// PLAN §8) — requires an rsync binary and is deliberately not in M3.

import { posix } from 'node:path';

/** A directory entry on the remote (for preflight/listing). */
export interface RemoteEntry {
  name: string;
  type: 'file' | 'dir' | 'other';
}

/**
 * The flat remote operations the sync engine needs. All paths are
 * absolute POSIX paths on the server. Implementations NEVER log credentials.
 */
export interface Transport {
  /** Protocol of this instance (for capability reporting). */
  readonly kind: 'sftp' | 'ftp' | 'ftps';
  /** true if the data connection reuses the control connection's TLS session. */
  readonly tlsSessionReuse: boolean | undefined;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  /** Contents of a remote directory (throws if it does not exist). */
  list(remoteDir: string): Promise<RemoteEntry[]>;
  /** Creates a directory recursively (idempotent). */
  ensureDir(remoteDir: string): Promise<void>;
  /** Removes a directory and its contents (only for the preflight probe/cleanup). */
  removeDir(remoteDir: string): Promise<void>;
  /** Uploads a buffer (overwrites an existing file). */
  uploadFile(remotePath: string, data: Buffer): Promise<void>;
  /** Deletes a file (idempotent — no error if already gone). */
  deleteFile(remotePath: string): Promise<void>;
  /** Reads a file; null if it does not exist. */
  readFile(remotePath: string): Promise<Buffer | null>;
  /** Writes a file as atomically as possible (temp + rename, with fallback). */
  writeFile(remotePath: string, data: Buffer): Promise<void>;
  /** Type of a remote path or false if it does not exist. */
  exists(remotePath: string): Promise<'file' | 'dir' | false>;
  /** Renames/moves (for the capability probe; v1 does not build on it). */
  rename(fromPath: string, toPath: string): Promise<void>;
}

/** Normalizes the remote root: leading slash, no trailing slash. */
export function normalizeRoot(remotePath: string): string {
  let p = remotePath.replace(/\\/g, '/').trim();
  if (p.length === 0) p = '.';
  // Relative roots (e.g. "htdocs", ".") stay relative; absolute ones are
  // cleanly canonicalized. No forcing of "/" — some hosters chroot.
  if (p.startsWith('/')) {
    p = posix.normalize(p);
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  } else {
    p = posix.normalize(p).replace(/\/+$/, '');
  }
  return p;
}

/** Joins remote root + relative path into an absolute remote path. */
export function remoteJoin(root: string, rel: string): string {
  return posix.join(root, rel);
}

/**
 * All directories (relative to the root) that must exist for the given file
 * paths — deduplicated and sorted shallow-first (parents before children, so
 * that even hosters without recursive mkdir see the correct order).
 */
export function ancestorDirsOf(relFilePaths: readonly string[]): string[] {
  const dirs = new Set<string>();
  for (const rel of relFilePaths) {
    const parts = rel.split('/');
    parts.pop(); // remove file name
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      dirs.add(acc);
    }
  }
  return [...dirs].sort((a, b) => {
    const depth = a.split('/').length - b.split('/').length;
    return depth !== 0 ? depth : a.localeCompare(b);
  });
}

interface ErrnoLike {
  code?: string | number;
  message?: string;
}

/**
 * Translates transport errors into clear messages for the
 * common shared-hosting cases: auth, wrong path, connection, TLS.
 * NEVER contains credentials — only the caller's host/port/path context.
 */
export function describeError(err: unknown, context: string): string {
  const e = (err ?? {}) as ErrnoLike;
  const code = typeof e.code === 'string' ? e.code : '';
  const msg = (e.message ?? String(err)).toLowerCase();
  const numeric = typeof e.code === 'number' ? e.code : undefined;

  if (code === 'ECONNREFUSED' || msg.includes('econnrefused')) {
    return `${context}: The connection was refused. Is the service running and the port correct?`;
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || msg.includes('getaddrinfo')) {
    return `${context}: Could not resolve the server name. Is the host correct?`;
  }
  if (code === 'ETIMEDOUT' || msg.includes('timed out') || msg.includes('timeout')) {
    return `${context}: Timeout while connecting. Check firewall, port, or host.`;
  }
  if (
    msg.includes('authentication') ||
    msg.includes('all configured authentication methods failed') ||
    msg.includes('login incorrect') ||
    msg.includes('530') ||
    msg.includes('permission denied') ||
    msg.includes('username') ||
    msg.includes('password')
  ) {
    return `${context}: Authentication failed. Check the username, password, or key.`;
  }
  if (
    msg.includes('ssl') ||
    msg.includes('tls') ||
    msg.includes('certificate') ||
    msg.includes('wrong version number') ||
    msg.includes('secure')
  ) {
    return `${context}: TLS problem. Does the server require explicit FTPS — or not?`;
  }
  if (
    code === 'ENOENT' ||
    msg.includes('550') ||
    msg.includes('no such file') ||
    msg.includes('not exist') ||
    msg.includes('not a directory')
  ) {
    return `${context}: The target path does not exist or is not writable. Is the directory correct?`;
  }
  if (numeric !== undefined) {
    return `${context}: The server rejected with code ${numeric}.`;
  }
  return `${context}: ${e.message ?? 'Unknown error'}`;
}
