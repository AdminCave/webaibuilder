/**
 * Headless tests of the IPC argument schemas (defense-in-depth, AP4): valid
 * payloads pass, malformed ones are rejected with a readable reason. No Electron
 * needed — pure zod validation.
 */

import { describe, expect, it } from 'vitest';

import { IpcChannels } from '@webaibuilder/core';

import { DesktopIpcChannels } from '../shared/channels';
import { validateIpcArgs } from './ipcSchemas';

describe('validateIpcArgs — channels without a schema', () => {
  it('passes argument-less/unknown channels through unvalidated', () => {
    expect(validateIpcArgs(DesktopIpcChannels.chatInterrupt, [])).toBeNull();
    expect(validateIpcArgs('wab:v1:does-not-exist', ['whatever'])).toBeNull();
  });
});

describe('validateIpcArgs — chat & settings', () => {
  it('chatSend: valid / empty prompt / wrong shape', () => {
    const ch = DesktopIpcChannels.chatSend;
    expect(validateIpcArgs(ch, [{ prompt: 'Build a page', runId: 'r1' }])).toBeNull();
    expect(validateIpcArgs(ch, [{ prompt: '', runId: 'r1' }])).not.toBeNull();
    expect(validateIpcArgs(ch, ['just a string'])).not.toBeNull();
    expect(validateIpcArgs(ch, [{ prompt: 'x', runId: 'r1', extra: true }])).not.toBeNull();
  });

  it('settingsSet: allows partial updates, rejects unknown backends/fields', () => {
    const ch = DesktopIpcChannels.settingsSet;
    expect(validateIpcArgs(ch, [{}])).toBeNull();
    expect(validateIpcArgs(ch, [{ backendId: 'claude-cli' }])).toBeNull();
    expect(validateIpcArgs(ch, [{ apiKey: null }])).toBeNull();
    expect(validateIpcArgs(ch, [{ apiKey: 'sk-x', provider: 'openai', model: 'gpt-x' }])).toBeNull();
    expect(validateIpcArgs(ch, [{ backendId: 'does-not-exist' }])).not.toBeNull();
    expect(validateIpcArgs(ch, [{ tokenUrl: 'https://evil' }])).not.toBeNull();
  });

  it('chatPermission: requestId + allow are required', () => {
    const ch = DesktopIpcChannels.chatPermission;
    expect(validateIpcArgs(ch, [{ requestId: 'p1', allow: true }])).toBeNull();
    expect(validateIpcArgs(ch, [{ requestId: 'p1', allow: true, remember: false }])).toBeNull();
    expect(validateIpcArgs(ch, [{ requestId: '', allow: true }])).not.toBeNull();
    expect(validateIpcArgs(ch, [{ allow: true }])).not.toBeNull();
  });
});

describe('validateIpcArgs — Deploy', () => {
  it('deployTargetsSave: a complete target passes, broken ports/protocols do not', () => {
    const ch = DesktopIpcChannels.deployTargetsSave;
    const target = {
      name: 'Webspace',
      protocol: 'sftp',
      host: 'example.de',
      port: 22,
      username: 'kevin',
      remotePath: '/htdocs',
      password: 'secret',
    };
    expect(validateIpcArgs(ch, ['proj1', target])).toBeNull();
    expect(validateIpcArgs(ch, ['proj1', { ...target, port: 0 }])).not.toBeNull();
    expect(validateIpcArgs(ch, ['proj1', { ...target, port: 99999 }])).not.toBeNull();
    expect(validateIpcArgs(ch, ['proj1', { ...target, protocol: 'scp' }])).not.toBeNull();
    expect(validateIpcArgs(ch, ['', target])).not.toBeNull();
  });

  it('deployRollback: four strings, SHA not empty', () => {
    const ch = DesktopIpcChannels.deployRollback;
    expect(validateIpcArgs(ch, ['p', 't', 'abc1234', 'run'])).toBeNull();
    expect(validateIpcArgs(ch, ['p', 't', '', 'run'])).not.toBeNull();
    expect(validateIpcArgs(ch, ['p', 't'])).not.toBeNull();
  });
});

describe('validateIpcArgs — backends, logs, projects', () => {
  it('backendsOpenHint: URLs only', () => {
    const ch = DesktopIpcChannels.backendsOpenHint;
    expect(validateIpcArgs(ch, ['https://docs.claude.com/x'])).toBeNull();
    expect(validateIpcArgs(ch, ['not-a-url'])).not.toBeNull();
  });

  it('logsTail: 1–5000', () => {
    const ch = DesktopIpcChannels.logsTail;
    expect(validateIpcArgs(ch, [500])).toBeNull();
    expect(validateIpcArgs(ch, [0])).not.toBeNull();
    expect(validateIpcArgs(ch, [5001])).not.toBeNull();
    expect(validateIpcArgs(ch, ['500'])).not.toBeNull();
  });

  it('logsReport: known report shapes only', () => {
    const ch = DesktopIpcChannels.logsReport;
    expect(validateIpcArgs(ch, [{ kind: 'error', message: 'broken' }])).toBeNull();
    expect(
      validateIpcArgs(ch, [{ kind: 'error', message: 'x', stack: 's', line: 1, column: 2 }]),
    ).toBeNull();
    expect(validateIpcArgs(ch, [{ kind: 'panic', message: 'x' }])).not.toBeNull();
  });

  it('projectsCreate/Update: name + template resp. strict partial update', () => {
    expect(
      validateIpcArgs(IpcChannels.projectsCreate, [{ name: 'Club website', templateId: 'basic' }]),
    ).toBeNull();
    expect(validateIpcArgs(IpcChannels.projectsCreate, [{ name: '' }])).not.toBeNull();
    expect(validateIpcArgs(IpcChannels.projectsUpdate, ['id1', { name: 'New' }])).toBeNull();
    expect(validateIpcArgs(IpcChannels.projectsUpdate, ['id1', { hack: true }])).not.toBeNull();
  });
});
