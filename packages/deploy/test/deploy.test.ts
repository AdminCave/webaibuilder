/**
 * Integration tests of the deploy engine against REAL in-process servers:
 * ssh2-SFTP and ftp-srv, each rooted at a temp "remote".
 *
 * For BOTH transports the real round-trips are verified:
 *  (a) Fresh deploy (3 files) + manifest with correct commit SHA, byte match
 *  (b) change one file → only that one is re-uploaded (write count)
 *  (c) delete one file → gone remotely, manifest no longer lists it
 *  (d) rollback to the first commit → remote == first tree, manifest SHA matches
 *  (e) preflight: ok against the server, clear errors for wrong path/login
 *  (f) drift detection: match = no drift, different SHA = drift + correct remote SHA
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

// File contents across the versions (fixed bytes → deterministic diff).
const INDEX_V1 = '<!doctype html><h1>Homepage v1</h1>\n';
const INDEX_V2 = '<!doctype html><h1>Homepage v2 (changed)</h1>\n';
const ABOUT = '<!doctype html><p>About us</p>\n';
const APP_JS = 'console.log("app v1");\n';
const CONTACT = '<!doctype html><p>Contact</p>\n';

const GIT_AUTHOR = { name: 'Test', email: 'test@example.invalid' } as const;

/** Writes a file at `<workspace>/site/<rel>`. */
async function writeSite(workspaceDir: string, rel: string, content: string): Promise<void> {
  const abs = join(workspaceDir, 'site', rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf8');
}

/** Stages all changes (incl. deletions) and commits → commit SHA. */
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

/** Reads a directory tree into a Map relPath→Buffer (without manifest/temp/probe). */
async function readTree(absDir: string): Promise<Map<string, Buffer>> {
  const tree = new Map<string, Buffer>();
  async function walk(dir: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // directory does not exist (yet)
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
  let remoteFilesRoot: string; // <serverRoot>/htdocs — the "remote" files
  let sha1 = '';
  let sha2 = '';
  let sha3 = '';
  let sha4 = '';

  /** Write ops in the current window, reduced to site-relative paths & sorted. */
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

    // First commit (3 files).
    await writeSite(workspaceDir, 'index.html', INDEX_V1);
    await writeSite(workspaceDir, 'about.html', ABOUT);
    await writeSite(workspaceDir, 'assets/app.js', APP_JS);
    sha1 = await commitAll(workspaceDir, 'Initial state');

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

  it('(a) fresh deploy uploads all 3 files, writes manifest with SHA, byte match', async () => {
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

    // Only the 3 files were actually written.
    expect(uploadedPaths()).toEqual(['about.html', 'assets/app.js', 'index.html']);

    // Progress is file-by-file + manifest last.
    expect(events).toContain('uploading');
    expect(events).toContain('manifest-written');
    expect(events.at(-1)).toBe('done');

    // Remote tree == local tree (byte-exact).
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

  it('(b) change one file → only that one is re-uploaded, manifest SHA updated', async () => {
    await writeSite(workspaceDir, 'index.html', INDEX_V2);
    sha2 = await commitAll(workspaceDir, 'Homepage changed');
    expect(sha2).not.toBe(sha1);

    server.resetWrites();
    const result = await deploy(target, creds, { siteDir, commitSha: sha2 });

    expect(result.uploaded).toBe(1);
    expect(result.unchanged).toBe(2);
    expect(result.deleted).toBe(0);
    expect(result.plan.uploads).toEqual(['index.html']);

    // Only index.html was written — about.html & assets/app.js were left untouched.
    expect(uploadedPaths()).toEqual(['index.html']);

    await expectRemoteMatches({
      'index.html': INDEX_V2,
      'about.html': ABOUT,
      'assets/app.js': APP_JS,
    });
    expect((await readRemoteManifest()).commit).toBe(sha2);
  });

  it('(c) delete one file → removed remotely, manifest no longer lists it', async () => {
    await rm(join(siteDir, 'about.html'));
    sha3 = await commitAll(workspaceDir, 'About page removed');

    server.resetWrites();
    const result = await deploy(target, creds, { siteDir, commitSha: sha3 });

    expect(result.deleted).toBe(1);
    expect(result.uploaded).toBe(0);
    expect(result.plan.deletes).toEqual(['about.html']);
    // No payload file uploaded (only the manifest is written).
    expect(uploadedPaths()).toEqual([]);

    await expectRemoteMatches({
      'index.html': INDEX_V2,
      'assets/app.js': APP_JS,
    });

    const manifest = await readRemoteManifest();
    expect(manifest.commit).toBe(sha3);
    expect(Object.keys(manifest.files)).not.toContain('about.html');
  });

  it('intermediate step: deploy a file added later (rollback preparation)', async () => {
    await writeSite(workspaceDir, 'contact.html', CONTACT);
    sha4 = await commitAll(workspaceDir, 'Contact page added');

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

  it('(d) rollback to the first commit → remote == first tree, manifest SHA = first commit', async () => {
    server.resetWrites();
    const result = await rollback(target, creds, {
      workspaceDir,
      toCommitSha: sha1,
    });

    expect(result.commit).toBe(sha1);
    // about.html comes back, index.html is rolled back → 2 uploads.
    expect(result.uploaded).toBe(2);
    // contact.html (added later) is removed.
    expect(result.deleted).toBe(1);
    expect(result.plan.deletes).toEqual(['contact.html']);
    expect(uploadedPaths()).toEqual(['about.html', 'index.html']);

    // Remote tree == exactly the first commit.
    await expectRemoteMatches({
      'index.html': INDEX_V1,
      'about.html': ABOUT,
      'assets/app.js': APP_JS,
    });
    expect((await readRemoteManifest()).commit).toBe(sha1);
  });

  it('(e) preflight: ok against the server, clear errors for wrong login and path', async () => {
    await mkdir(remoteFilesRoot, { recursive: true });

    const ok = await preflight(target, creds);
    expect(ok.ok).toBe(true);
    expect(ok.failures).toEqual([]);
    expect(ok.capabilities.mkdirRecursive).toBe(true);
    expect(ok.remoteSha).toBe(sha1); // state after rollback
    expect(ok.messages.join(' ')).toMatch(/authentication|reachable/);

    const badLogin = await preflight(target, { password: 'wrong' });
    expect(badLogin.ok).toBe(false);
    expect(badLogin.failures.length).toBeGreaterThan(0);
    expect(badLogin.failures.join(' ')).toMatch(/Authentication|Connection/);

    const badPath = await preflight({ ...target, remotePath: '/does-not-exist' }, creds);
    expect(badPath.ok).toBe(false);
    expect(badPath.failures.length).toBeGreaterThan(0);
  });

  it('(f) drift detection: match = no drift, different SHA = drift with correct remote SHA', async () => {
    const remoteSha = (await readRemoteManifest()).commit;

    const match = await detectDrift(target, creds, remoteSha);
    expect(match.drift).toBe(false);
    expect(match.remoteSha).toBe(remoteSha);

    const drift = await detectDrift(target, creds, '0000000000000000000000000000000000000000');
    expect(drift.drift).toBe(true);
    expect(drift.remoteSha).toBe(remoteSha);

    // Pure comparison function (no network).
    expect(compareDrift('abc', 'abc')).toEqual({ drift: false, expectedSha: 'abc', remoteSha: 'abc' });
    expect(compareDrift('abc', null)).toEqual({ drift: true, expectedSha: 'abc', remoteSha: null });
  });

  it('planDeploy (pure diff, no network) matches the remote manifest', async () => {
    const manifest = await readRemoteManifest(); // state: first commit
    const plan = await planDeploy(siteDir, manifest);
    // Working directory is at sha4 (index v2, assets, contact), manifest at sha1.
    expect(plan.uploads).toEqual(['contact.html', 'index.html']);
    expect(plan.deletes).toEqual(['about.html']);
  });
});
