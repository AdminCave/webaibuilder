/**
 * Transport-Abstraktion: eine schmale Schnittstelle, hinter der SFTP
 * (ssh2-sftp-client) und FTP/FTPS (basic-ftp) austauschbar sind (PLAN §4).
 * Die Sync-Engine kennt nur dieses Interface. rsync ist in M3 NICHT dabei.
 */

// TODO(v1.1): rsync-Transport als erkannter Opt-in (Windows-Problematik,
// PLAN §8) — braucht ein rsync-Binary und ist bewusst nicht in M3.

import { posix } from 'node:path';

/** Ein Verzeichniseintrag auf dem Remote (für Preflight/Listing). */
export interface RemoteEntry {
  name: string;
  type: 'file' | 'dir' | 'other';
}

/**
 * Die flachen Remote-Operationen, die die Sync-Engine braucht. Alle Pfade sind
 * absolute POSIX-Pfade auf dem Server. Implementierungen loggen NIE Credentials.
 */
export interface Transport {
  /** Protokoll dieser Instanz (für Capability-Reporting). */
  readonly kind: 'sftp' | 'ftp' | 'ftps';
  /** true, wenn die Datenverbindung die TLS-Session der Steuerverbindung wiederverwendet. */
  readonly tlsSessionReuse: boolean | undefined;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  /** Inhalt eines Remote-Verzeichnisses (wirft, wenn es nicht existiert). */
  list(remoteDir: string): Promise<RemoteEntry[]>;
  /** Legt ein Verzeichnis rekursiv an (idempotent). */
  ensureDir(remoteDir: string): Promise<void>;
  /** Entfernt ein Verzeichnis samt Inhalt (nur für die Preflight-Probe/Cleanup). */
  removeDir(remoteDir: string): Promise<void>;
  /** Lädt einen Puffer hoch (überschreibt vorhandene Datei). */
  uploadFile(remotePath: string, data: Buffer): Promise<void>;
  /** Löscht eine Datei (idempotent — kein Fehler, wenn schon weg). */
  deleteFile(remotePath: string): Promise<void>;
  /** Liest eine Datei; null, wenn sie nicht existiert. */
  readFile(remotePath: string): Promise<Buffer | null>;
  /** Schreibt eine Datei möglichst atomar (temp + rename, mit Fallback). */
  writeFile(remotePath: string, data: Buffer): Promise<void>;
  /** Typ eines Remote-Pfads oder false, wenn er nicht existiert. */
  exists(remotePath: string): Promise<'file' | 'dir' | false>;
  /** Benennt/verschiebt um (für die Capability-Probe; v1 baut nicht darauf). */
  rename(fromPath: string, toPath: string): Promise<void>;
}

/** Normalisiert das Remote-Root: führender Slash, kein abschließender Slash. */
export function normalizeRoot(remotePath: string): string {
  let p = remotePath.replace(/\\/g, '/').trim();
  if (p.length === 0) p = '.';
  // Relative Roots (z. B. "htdocs", ".") bleiben relativ; absolute werden
  // sauber kanonisiert. Kein Erzwingen von "/" — manche Hoster chrooten.
  if (p.startsWith('/')) {
    p = posix.normalize(p);
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  } else {
    p = posix.normalize(p).replace(/\/+$/, '');
  }
  return p;
}

/** Fügt Remote-Root + relativen Pfad zu einem absoluten Remote-Pfad zusammen. */
export function remoteJoin(root: string, rel: string): string {
  return posix.join(root, rel);
}

/**
 * Alle Verzeichnisse (relativ zum Root), die für die gegebenen Dateipfade
 * existieren müssen — dedupliziert und flach-zuerst sortiert (Eltern vor Kind,
 * damit auch Hoster ohne rekursives mkdir die Reihenfolge korrekt sehen).
 */
export function ancestorDirsOf(relFilePaths: readonly string[]): string[] {
  const dirs = new Set<string>();
  for (const rel of relFilePaths) {
    const parts = rel.split('/');
    parts.pop(); // Dateinamen entfernen
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
 * Übersetzt Transport-Fehler in klare deutsche Meldungen (Du-Form) für die
 * häufigen Shared-Hosting-Fälle: Auth, falscher Pfad, Verbindung, TLS.
 * Enthält NIE Credentials — nur Host/Port/Pfad-Kontext des Aufrufers.
 */
export function describeError(err: unknown, context: string): string {
  const e = (err ?? {}) as ErrnoLike;
  const code = typeof e.code === 'string' ? e.code : '';
  const msg = (e.message ?? String(err)).toLowerCase();
  const numeric = typeof e.code === 'number' ? e.code : undefined;

  if (code === 'ECONNREFUSED' || msg.includes('econnrefused')) {
    return `${context}: Die Verbindung wurde abgelehnt. Läuft der Dienst und stimmt der Port?`;
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || msg.includes('getaddrinfo')) {
    return `${context}: Den Server-Namen konnte ich nicht auflösen. Stimmt der Host?`;
  }
  if (code === 'ETIMEDOUT' || msg.includes('timed out') || msg.includes('timeout')) {
    return `${context}: Zeitüberschreitung beim Verbinden. Firewall, Port oder Host prüfen.`;
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
    return `${context}: Anmeldung fehlgeschlagen. Prüf Benutzernamen, Passwort bzw. den Schlüssel.`;
  }
  if (
    msg.includes('ssl') ||
    msg.includes('tls') ||
    msg.includes('certificate') ||
    msg.includes('wrong version number') ||
    msg.includes('secure')
  ) {
    return `${context}: TLS-Problem. Verlangt der Server explizites FTPS – oder gerade nicht?`;
  }
  if (
    code === 'ENOENT' ||
    msg.includes('550') ||
    msg.includes('no such file') ||
    msg.includes('not exist') ||
    msg.includes('not a directory')
  ) {
    return `${context}: Der Zielpfad existiert nicht oder ist nicht beschreibbar. Stimmt das Verzeichnis?`;
  }
  if (numeric !== undefined) {
    return `${context}: Der Server hat mit Code ${numeric} abgelehnt.`;
  }
  return `${context}: ${e.message ?? 'Unbekannter Fehler'}`;
}
