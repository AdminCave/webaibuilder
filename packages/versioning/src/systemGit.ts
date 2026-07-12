/**
 * GitRepo-Implementierung über das System-git-Binary (simple-git).
 * Wird bevorzugt, wenn ein git-Binary gefunden wird — schneller und
 * 1:1 kompatibel mit dem, was Nutzer mit normalem git sehen.
 */

import { simpleGit, type SimpleGit } from 'simple-git';

import { GIT_AUTHOR, type GitRepo, type RawAnnotatedTag, type RawCommit } from './repo';

/** Feld-/Datensatztrenner für maschinenlesbares `git log`/`for-each-ref`. */
const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';

const FULL_SHA_RE = /^[0-9a-f]{40}$/i;

export class SystemGitRepo implements GitRepo {
  private readonly git: SimpleGit;

  constructor(workspaceDir: string) {
    this.git = simpleGit({
      baseDir: workspaceDir,
      // Checkpoints werden von der App erstellt, nicht vom Nutzer — feste
      // Identität, kein Signieren (globale gpgsign-Configs würden sonst
      // Commits in Workspaces blockieren).
      config: [
        `user.name=${GIT_AUTHOR.name}`,
        `user.email=${GIT_AUTHOR.email}`,
        'commit.gpgsign=false',
        'tag.gpgsign=false',
      ],
    });
  }

  async init(): Promise<void> {
    await this.git.raw(['init']);
    // Branch-Name deterministisch auf `main`, unabhängig von init.defaultBranch
    // des Nutzers — aber nur solange das Repo noch keinen Commit hat.
    if (!(await this.hasCommits())) {
      await this.git.raw(['symbolic-ref', 'HEAD', 'refs/heads/main']);
    }
  }

  async hasCommits(): Promise<boolean> {
    // Kein --quiet: simple-git erkennt Fehler nur an stderr-Ausgabe —
    // mit --quiet "gelingt" rev-parse auf einem Repo ohne Commits scheinbar.
    try {
      const out = await this.git.raw(['rev-parse', '--verify', 'HEAD']);
      return FULL_SHA_RE.test(out.trim());
    } catch {
      return false;
    }
  }

  async addAll(): Promise<void> {
    await this.git.raw(['add', '--all']);
  }

  async commit(message: string): Promise<string> {
    // --allow-empty: ein Checkpoint pro Agent-Turn, auch wenn der Turn nichts
    // geändert hat — die Timeline bleibt 1:1 zu den Turns.
    await this.git.raw(['commit', '--allow-empty', '--no-verify', '-m', message]);
    return this.headSha();
  }

  async log(maxCount?: number): Promise<RawCommit[]> {
    const args = ['log', `--format=%H%x1f%aI%x1f%B%x1e`];
    if (maxCount !== undefined) {
      args.push('-n', String(maxCount));
    }
    let out: string;
    try {
      out = await this.git.raw(args);
    } catch {
      // Repo ohne Commits ("does not have any commits yet")
      return [];
    }
    const commits: RawCommit[] = [];
    for (const record of out.split(RECORD_SEP)) {
      const trimmed = record.replace(/^\s+/, '');
      if (trimmed.length === 0) continue;
      const [sha = '', date = '', body = ''] = trimmed.split(FIELD_SEP);
      if (sha.length > 0) {
        commits.push({ sha, date, body: body.replace(/\s+$/, '') });
      }
    }
    return commits;
  }

  async createAnnotatedTag(tagName: string, targetSha: string, message: string): Promise<void> {
    await this.git.raw(['tag', '-a', tagName, '-m', message, targetSha]);
  }

  async listAnnotatedTags(): Promise<RawAnnotatedTag[]> {
    // %(objectname) = Tag-Objekt, %(*objectname) = gepeelter Commit (nur bei
    // annotated Tags gefüllt), %(contents:subject) = erste Zeile der Message.
    const out = await this.git.raw([
      'for-each-ref',
      'refs/tags',
      `--format=%(refname:short)%1f%(objectname)%1f%(*objectname)%1f%(contents:subject)%1e`,
    ]);
    const tags: RawAnnotatedTag[] = [];
    for (const record of out.split(RECORD_SEP)) {
      const trimmed = record.replace(/^\s+/, '');
      if (trimmed.length === 0) continue;
      const [tagName = '', , peeledSha = '', subject = ''] = trimmed.split(FIELD_SEP);
      if (tagName.length > 0 && peeledSha.length > 0) {
        tags.push({ tagName, targetSha: peeledSha, message: subject });
      }
    }
    return tags;
  }

  async listTagNames(): Promise<string[]> {
    const out = await this.git.raw(['tag', '--list']);
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  async isDirty(): Promise<boolean> {
    const status = await this.git.status();
    return !status.isClean();
  }

  async restoreTree(sha: string): Promise<void> {
    // read-tree --reset -u: Index := Ziel-Baum, Arbeitsverzeichnis wird
    // angepasst (inkl. Löschen nicht mehr vorhandener Dateien). HEAD bleibt
    // auf dem Branch — kein detached HEAD.
    await this.git.raw(['read-tree', '--reset', '-u', sha]);
  }

  async resolveCommit(ref: string): Promise<string> {
    // Kein --quiet (siehe hasCommits); zusätzlich Ergebnis validieren.
    const out = await this.git.raw(['rev-parse', '--verify', `${ref}^{commit}`]);
    const sha = out.trim();
    if (!FULL_SHA_RE.test(sha)) {
      throw new Error(`Keine Commit-SHA für "${ref}".`);
    }
    return sha;
  }

  async headSha(): Promise<string> {
    const out = await this.git.raw(['rev-parse', 'HEAD']);
    return out.trim();
  }
}
