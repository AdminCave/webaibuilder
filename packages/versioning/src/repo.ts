/**
 * Interner Backend-Vertrag: eine schmale git-Abstraktion, hinter der
 * simple-git (System-git) und isomorphic-git (Fallback ohne git-Binary)
 * austauschbar sind. Aufrufer (index.ts) kennen nur dieses Interface.
 */

/** Welche git-Implementierung benutzt wird. */
export type GitBackendKind = 'system' | 'isomorphic';

/** Identität, mit der die App Checkpoints/Tags erstellt (nicht der Nutzer). */
export const GIT_AUTHOR = {
  name: 'Web AI Builder',
  email: 'checkpoints@webaibuilder.invalid',
} as const;

/** Roh-Commit aus `git log` (noch nicht als Checkpoint interpretiert). */
export interface RawCommit {
  /** Volle Commit-SHA. */
  sha: string;
  /** Autor-Datum (ISO 8601 oder Epoch-basiert; wird später normalisiert). */
  date: string;
  /** Vollständige Commit-Message (Subject + Trailer). */
  body: string;
}

/** Annotated Tag inkl. gepeelter Ziel-SHA und Tag-Message (= Versionsname). */
export interface RawAnnotatedTag {
  tagName: string;
  /** SHA des Commits, auf den der Tag (gepeelt) zeigt. */
  targetSha: string;
  /** Tag-Message; erste Zeile = Anzeigename der Version. */
  message: string;
}

/**
 * Die flachen git-Operationen, die die Versionierung braucht (PLAN §4):
 * init, add -A, commit, annotated tag, log, tree-checkout, status, rev-parse.
 */
export interface GitRepo {
  /** `git init` mit Branch `main`; idempotent gedacht für frische Verzeichnisse. */
  init(): Promise<void>;
  /** true, wenn HEAD auf einen Commit zeigt (Repo nicht "unborn"). */
  hasCommits(): Promise<boolean>;
  /** `git add -A` — staged Neues, Geändertes und Gelöschtes. */
  addAll(): Promise<void>;
  /** Committet den Index (auch leer) und liefert die volle SHA. */
  commit(message: string): Promise<string>;
  /** Commits, neueste zuerst; leeres Array bei Repo ohne Commits. */
  log(maxCount?: number): Promise<RawCommit[]>;
  /** Annotated Tag auf `targetSha`; `message` trägt den Versionsnamen. */
  createAnnotatedTag(tagName: string, targetSha: string, message: string): Promise<void>;
  /** Alle annotated Tags (lightweight Tags werden ignoriert). */
  listAnnotatedTags(): Promise<RawAnnotatedTag[]>;
  /** Alle Tag-Namen (auch lightweight) — für Kollisionsprüfung. */
  listTagNames(): Promise<string[]>;
  /** true, wenn Arbeitsverzeichnis/Index vom HEAD abweichen (inkl. Untracked). */
  isDirty(): Promise<boolean>;
  /**
   * Setzt Arbeitsverzeichnis + Index auf den Baum von `sha` — inklusive
   * Löschen von Dateien, die es im Ziel nicht gibt. HEAD bleibt unberührt
   * (kein detached HEAD; der Restore-Commit passiert danach).
   */
  restoreTree(sha: string): Promise<void>;
  /** Löst eine Ref/Kurz-SHA zu einer vollen Commit-SHA auf (wirft sonst). */
  resolveCommit(ref: string): Promise<string>;
  /** Volle SHA von HEAD (wirft bei Repo ohne Commits). */
  headSha(): Promise<string>;
}
