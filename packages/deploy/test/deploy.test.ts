/**
 * Integrationstests der Deploy-Engine gegen ECHTE In-Process-Server:
 * ssh2-SFTP und ftp-srv, jeweils gerootet auf ein Temp-"Remote".
 *
 * Für BEIDE Transporte werden die realen Round-Trips geprüft:
 *  (a) Frisch-Deploy (3 Dateien) + Manifest mit korrekter Commit-SHA, Byte-Match
 *  (b) eine Datei ändern → nur die wird neu hochgeladen (Write-Zählung)
 *  (c) eine Datei löschen → remote weg, Manifest listet sie nicht mehr
 *  (d) Rollback auf den ersten Commit → Remote == erster Baum, Manifest-SHA passt
 *  (e) Preflight: ok gegen den Server, klare Fehler bei falschem Pfad/Login
 *  (f) Drift-Erkennung: Match = kein Drift, andere SHA = Drift + korrekte Remote-SHA
 */

import nodeFs from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import git from 'isomorphic-git';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DeployTarget } from '@webaibuilder/core';

import {
  compareDrift,
  deploy,
  detectDrift,
  MANIFEST_FILENAME,
  planDeploy,
  preflight,
  rollback,
  type DeployCredentials,
  type DeployManifest,
} from '../src/index';
import { SFTP_PASS, SFTP_USER, startSftpServer, type TestSftpServer } from './sftpServer';
import { FTP_PASS, FTP_USER, startFtpServer, type TestFtpServer } from './ftpServer';

const REMOTE_ROOT = '/htdocs';

// Datei-Inhalte über die Versionen hinweg (feste Bytes → deterministischer Diff).
const INDEX_V1 = '<!doctype html><h1>Startseite v1</h1>\n';
const INDEX_V2 = '<!doctype html><h1>Startseite v2 (geaendert)</h1>\n';
const ABOUT = '<!doctype html><p>Ueber uns</p>\n';
const APP_JS = 'console.log("app v1");\n';
const CONTACT = '<!doctype html><p>Kontakt</p>\n';

const GIT_AUTHOR = { name: 'Test', email: 'test@example.invalid' } as const;

/** Schreibt eine Datei unter `<workspace>/site/<rel>`. */
async function writeSite(workspaceDir: string, rel: string, content: string): Promise<void> {
  const abs = join(workspaceDir, 'site', rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf8');
}

/** Staged alle Änderungen (inkl. Löschungen) und committet → Commit-SHA. */
async function commitAll(workspaceDir: string, message: string): Promise<string> {
  const status = await git.statusMatrix({ fs: nodeFs, dir: workspaceDir });
  for (const row of status) {
    const filepath = row[0];
    const worktreeStatus = row[2];
    if (worktreeStatus === 0) {
      await git.remove({ fs: nodeFs, dir: workspaceDir, filepath });
    } else {
      await git.add({ fs: nodeFs, dir: workspaceDir, filepath });
    }
  }
  return git.commit({ fs: nodeFs, dir: workspaceDir, message, author: { ...GIT_AUTHOR } });
}

/** Liest einen Verzeichnisbaum in eine Map relPath→Buffer (ohne Manifest/Temp/Probe). */
async function readTree(absDir: string): Promise<Map<string, Buffer>> {
  const tree = new Map<string, Buffer>();
  async function walk(dir: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // Verzeichnis existiert (noch) nicht
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(abs, relPath);
      } else if (entry.isFile()) {
        if (isNoise(relPath)) continue;
        tree.set(relPath, await readFile(abs));
      }
    }
  }
  await walk(absDir, '');
  return tree;
}

function isNoise(rel: string): boolean {
  return (
    rel === MANIFEST_FILENAME ||
    rel.includes('.wabtmp') ||
    rel.startsWith('.wab-preflight')
  );
}

interface TransportCase {
  label: string;
  start(root: string): Promise<{ port: number; writes: string[]; resetWrites(): void; close(): Promise<void> }>;
  protocol: DeployTarget['protocol'];
  user: string;
  pass: string;
}

const CASES: TransportCase[] = [
  {
    label: 'SFTP',
    start: (root) => startSftpServer(root) as Promise<TestSftpServer>,
    protocol: 'sftp',
    user: SFTP_USER,
    pass: SFTP_PASS,
  },
  {
    label: 'FTP',
    start: (root) => startFtpServer(root) as Promise<TestFtpServer>,
    protocol: 'ftp',
    user: FTP_USER,
    pass: FTP_PASS,
  },
];

describe.each(CASES)('Transport: $label', (testCase) => {
  let serverRoot: string;
  let server: { port: number; writes: string[]; resetWrites(): void; close(): Promise<void> };
  let workspaceDir: string;
  let siteDir: string;
  let target: DeployTarget;
  let creds: DeployCredentials;
  let remoteFilesRoot: string; // <serverRoot>/htdocs — die "Remote"-Dateien
  let sha1 = '';
  let sha2 = '';
  let sha3 = '';
  let sha4 = '';

  /** Schreib-Ops im aktuellen Fenster, auf site-relative Pfade reduziert & sortiert. */
  function uploadedPaths(): string[] {
    const prefix = `${REMOTE_ROOT}/`;
    return server.writes
      .map((p) => (p.startsWith(prefix) ? p.slice(prefix.length) : p))
      .filter((rel) => !isNoise(rel))
      .sort();
  }

  async function readRemoteManifest(): Promise<DeployManifest> {
    const raw = await readFile(join(remoteFilesRoot, MANIFEST_FILENAME), 'utf8');
    return JSON.parse(raw) as DeployManifest;
  }

  async function expectRemoteMatches(expected: Record<string, string>): Promise<void> {
    const tree = await readTree(remoteFilesRoot);
    const actual: Record<string, string> = {};
    for (const [rel, buf] of tree) actual[rel] = buf.toString('utf8');
    expect(actual).toEqual(expected);
  }

  beforeAll(async () => {
    serverRoot = await mkdtemp(join(tmpdir(), `wab-remote-${testCase.label}-`));
    remoteFilesRoot = join(serverRoot, 'htdocs');
    server = await testCase.start(serverRoot);

    workspaceDir = await mkdtemp(join(tmpdir(), `wab-ws-${testCase.label}-`));
    siteDir = join(workspaceDir, 'site');
    await git.init({ fs: nodeFs, dir: workspaceDir, defaultBranch: 'main' });

    // Erster Commit (3 Dateien).
    await writeSite(workspaceDir, 'index.html', INDEX_V1);
    await writeSite(workspaceDir, 'about.html', ABOUT);
    await writeSite(workspaceDir, 'assets/app.js', APP_JS);
    sha1 = await commitAll(workspaceDir, 'Erststand');

    target = {
      id: 't1',
      name: `Test ${testCase.label}`,
      protocol: testCase.protocol,
      host: '127.0.0.1',
      port: server.port,
      username: testCase.user,
      remotePath: REMOTE_ROOT,
      credentialRef: 'test',
    };
    creds = { password: testCase.pass };
  });

  afterAll(async () => {
    await server.close();
    await rm(serverRoot, { recursive: true, force: true });
    await rm(workspaceDir, { recursive: true, force: true });
  });

  it('(a) frischer Deploy lädt alle 3 Dateien hoch, schreibt Manifest mit SHA, Byte-Match', async () => {
    server.resetWrites();
    const events: string[] = [];
    const result = await deploy(target, creds, {
      siteDir,
      commitSha: sha1,
      onProgress: (e) => events.push(e.type),
    });

    expect(result.uploaded).toBe(3);
    expect(result.deleted).toBe(0);
    expect(result.unchanged).toBe(0);
    expect(result.commit).toBe(sha1);
    expect(result.plan.uploads).toEqual(['about.html', 'assets/app.js', 'index.html']);
    expect(result.bytesUploaded).toBeGreaterThan(0);

    // Nur die 3 Dateien wurden wirklich geschrieben.
    expect(uploadedPaths()).toEqual(['about.html', 'assets/app.js', 'index.html']);

    // Progress ist file-by-file + Manifest zuletzt.
    expect(events).toContain('uploading');
    expect(events).toContain('manifest-written');
    expect(events.at(-1)).toBe('done');

    // Remote-Baum == lokaler Baum (byte-genau).
    await expectRemoteMatches({
      'index.html': INDEX_V1,
      'about.html': ABOUT,
      'assets/app.js': APP_JS,
    });

    const manifest = await readRemoteManifest();
    expect(manifest.commit).toBe(sha1);
    expect(Object.keys(manifest.files).sort()).toEqual([
      'about.html',
      'assets/app.js',
      'index.html',
    ]);
  });

  it('(b) eine Datei ändern → nur diese wird neu hochgeladen, Manifest-SHA aktualisiert', async () => {
    await writeSite(workspaceDir, 'index.html', INDEX_V2);
    sha2 = await commitAll(workspaceDir, 'Startseite geaendert');
    expect(sha2).not.toBe(sha1);

    server.resetWrites();
    const result = await deploy(target, creds, { siteDir, commitSha: sha2 });

    expect(result.uploaded).toBe(1);
    expect(result.unchanged).toBe(2);
    expect(result.deleted).toBe(0);
    expect(result.plan.uploads).toEqual(['index.html']);

    // Nur index.html wurde geschrieben — about.html & assets/app.js blieben unangetastet.
    expect(uploadedPaths()).toEqual(['index.html']);

    await expectRemoteMatches({
      'index.html': INDEX_V2,
      'about.html': ABOUT,
      'assets/app.js': APP_JS,
    });
    expect((await readRemoteManifest()).commit).toBe(sha2);
  });

  it('(c) eine Datei löschen → remote entfernt, Manifest listet sie nicht mehr', async () => {
    await rm(join(siteDir, 'about.html'));
    sha3 = await commitAll(workspaceDir, 'Ueber-Seite entfernt');

    server.resetWrites();
    const result = await deploy(target, creds, { siteDir, commitSha: sha3 });

    expect(result.deleted).toBe(1);
    expect(result.uploaded).toBe(0);
    expect(result.plan.deletes).toEqual(['about.html']);
    // Kein Upload einer Nutzdatei (nur das Manifest wird geschrieben).
    expect(uploadedPaths()).toEqual([]);

    await expectRemoteMatches({
      'index.html': INDEX_V2,
      'assets/app.js': APP_JS,
    });

    const manifest = await readRemoteManifest();
    expect(manifest.commit).toBe(sha3);
    expect(Object.keys(manifest.files)).not.toContain('about.html');
  });

  it('Zwischenschritt: später hinzugefügte Datei deployen (Vorbereitung Rollback)', async () => {
    await writeSite(workspaceDir, 'contact.html', CONTACT);
    sha4 = await commitAll(workspaceDir, 'Kontaktseite hinzugefuegt');

    server.resetWrites();
    const result = await deploy(target, creds, { siteDir, commitSha: sha4 });
    expect(result.uploaded).toBe(1);
    expect(result.plan.uploads).toEqual(['contact.html']);
    expect(uploadedPaths()).toEqual(['contact.html']);
    await expectRemoteMatches({
      'index.html': INDEX_V2,
      'assets/app.js': APP_JS,
      'contact.html': CONTACT,
    });
    expect((await readRemoteManifest()).commit).toBe(sha4);
  });

  it('(d) Rollback auf den ersten Commit → Remote == erster Baum, Manifest-SHA = erster Commit', async () => {
    server.resetWrites();
    const result = await rollback(target, creds, {
      workspaceDir,
      toCommitSha: sha1,
    });

    expect(result.commit).toBe(sha1);
    // about.html kehrt zurück, index.html wird zurückgedreht → 2 Uploads.
    expect(result.uploaded).toBe(2);
    // contact.html (später hinzugefügt) wird entfernt.
    expect(result.deleted).toBe(1);
    expect(result.plan.deletes).toEqual(['contact.html']);
    expect(uploadedPaths()).toEqual(['about.html', 'index.html']);

    // Remote-Baum == exakt der erste Commit.
    await expectRemoteMatches({
      'index.html': INDEX_V1,
      'about.html': ABOUT,
      'assets/app.js': APP_JS,
    });
    expect((await readRemoteManifest()).commit).toBe(sha1);
  });

  it('(e) Preflight: ok gegen den Server, klare Fehler bei falschem Login und Pfad', async () => {
    await mkdir(remoteFilesRoot, { recursive: true });

    const ok = await preflight(target, creds);
    expect(ok.ok).toBe(true);
    expect(ok.failures).toEqual([]);
    expect(ok.capabilities.mkdirRecursive).toBe(true);
    expect(ok.remoteSha).toBe(sha1); // Stand nach Rollback
    expect(ok.messages.join(' ')).toMatch(/Anmeldung|erreichbar/);

    const badLogin = await preflight(target, { password: 'falsch' });
    expect(badLogin.ok).toBe(false);
    expect(badLogin.failures.length).toBeGreaterThan(0);
    expect(badLogin.failures.join(' ')).toMatch(/Anmeldung|Verbindung/);

    const badPath = await preflight({ ...target, remotePath: '/gibt-es-nicht' }, creds);
    expect(badPath.ok).toBe(false);
    expect(badPath.failures.length).toBeGreaterThan(0);
  });

  it('(f) Drift-Erkennung: Match = kein Drift, andere SHA = Drift mit korrekter Remote-SHA', async () => {
    const remoteSha = (await readRemoteManifest()).commit;

    const match = await detectDrift(target, creds, remoteSha);
    expect(match.drift).toBe(false);
    expect(match.remoteSha).toBe(remoteSha);

    const drift = await detectDrift(target, creds, '0000000000000000000000000000000000000000');
    expect(drift.drift).toBe(true);
    expect(drift.remoteSha).toBe(remoteSha);

    // Reine Vergleichsfunktion (ohne Netz).
    expect(compareDrift('abc', 'abc')).toEqual({ drift: false, expectedSha: 'abc', remoteSha: 'abc' });
    expect(compareDrift('abc', null)).toEqual({ drift: true, expectedSha: 'abc', remoteSha: null });
  });

  it('planDeploy (reiner Diff, ohne Netz) stimmt mit dem Remote-Manifest überein', async () => {
    const manifest = await readRemoteManifest(); // Stand: erster Commit
    const plan = await planDeploy(siteDir, manifest);
    // Arbeitsverzeichnis ist bei sha4 (index v2, assets, contact), Manifest bei sha1.
    expect(plan.uploads).toEqual(['contact.html', 'index.html']);
    expect(plan.deletes).toEqual(['about.html']);
  });
});
