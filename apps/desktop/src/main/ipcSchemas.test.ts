/**
 * Headless-Tests der IPC-Argument-Schemas (Defense-in-Depth, AP4): gültige
 * Nutzlasten passieren, fehlgeformte werden mit lesbarer Begründung abgelehnt.
 * Kein Electron nötig — reine zod-Validierung.
 */

import { describe, expect, it } from 'vitest';

import { IpcChannels } from '@webaibuilder/core';

import { DesktopIpcChannels } from '../shared/channels';
import { validateIpcArgs } from './ipcSchemas';

describe('validateIpcArgs — Kanäle ohne Schema', () => {
  it('lässt argumentlose/unbekannte Kanäle unvalidiert durch', () => {
    expect(validateIpcArgs(DesktopIpcChannels.chatInterrupt, [])).toBeNull();
    expect(validateIpcArgs('wab:v1:gibts-nicht', ['egal'])).toBeNull();
  });
});

describe('validateIpcArgs — Chat & Einstellungen', () => {
  it('chatSend: gültig / leerer Prompt / falsche Form', () => {
    const ch = DesktopIpcChannels.chatSend;
    expect(validateIpcArgs(ch, [{ prompt: 'Bau eine Seite', runId: 'r1' }])).toBeNull();
    expect(validateIpcArgs(ch, [{ prompt: '', runId: 'r1' }])).not.toBeNull();
    expect(validateIpcArgs(ch, ['nur ein String'])).not.toBeNull();
    expect(validateIpcArgs(ch, [{ prompt: 'x', runId: 'r1', extra: true }])).not.toBeNull();
  });

  it('settingsSet: erlaubt Teil-Updates, lehnt unbekannte Backends/Felder ab', () => {
    const ch = DesktopIpcChannels.settingsSet;
    expect(validateIpcArgs(ch, [{}])).toBeNull();
    expect(validateIpcArgs(ch, [{ backendId: 'claude-cli' }])).toBeNull();
    expect(validateIpcArgs(ch, [{ apiKey: null }])).toBeNull();
    expect(validateIpcArgs(ch, [{ apiKey: 'sk-x', provider: 'openai', model: 'gpt-x' }])).toBeNull();
    expect(validateIpcArgs(ch, [{ backendId: 'gibts-nicht' }])).not.toBeNull();
    expect(validateIpcArgs(ch, [{ tokenUrl: 'https://evil' }])).not.toBeNull();
  });

  it('chatPermission: requestId + allow sind Pflicht', () => {
    const ch = DesktopIpcChannels.chatPermission;
    expect(validateIpcArgs(ch, [{ requestId: 'p1', allow: true }])).toBeNull();
    expect(validateIpcArgs(ch, [{ requestId: 'p1', allow: true, remember: false }])).toBeNull();
    expect(validateIpcArgs(ch, [{ requestId: '', allow: true }])).not.toBeNull();
    expect(validateIpcArgs(ch, [{ allow: true }])).not.toBeNull();
  });
});

describe('validateIpcArgs — Deploy', () => {
  it('deployTargetsSave: vollständiges Ziel passiert, kaputte Ports/Protokolle nicht', () => {
    const ch = DesktopIpcChannels.deployTargetsSave;
    const target = {
      name: 'Webspace',
      protocol: 'sftp',
      host: 'example.de',
      port: 22,
      username: 'kevin',
      remotePath: '/htdocs',
      password: 'geheim',
    };
    expect(validateIpcArgs(ch, ['proj1', target])).toBeNull();
    expect(validateIpcArgs(ch, ['proj1', { ...target, port: 0 }])).not.toBeNull();
    expect(validateIpcArgs(ch, ['proj1', { ...target, port: 99999 }])).not.toBeNull();
    expect(validateIpcArgs(ch, ['proj1', { ...target, protocol: 'scp' }])).not.toBeNull();
    expect(validateIpcArgs(ch, ['', target])).not.toBeNull();
  });

  it('deployRollback: vier Strings, SHA nicht leer', () => {
    const ch = DesktopIpcChannels.deployRollback;
    expect(validateIpcArgs(ch, ['p', 't', 'abc1234', 'run'])).toBeNull();
    expect(validateIpcArgs(ch, ['p', 't', '', 'run'])).not.toBeNull();
    expect(validateIpcArgs(ch, ['p', 't'])).not.toBeNull();
  });
});

describe('validateIpcArgs — Backends, Logs, Projekte', () => {
  it('backendsOpenHint: nur URLs', () => {
    const ch = DesktopIpcChannels.backendsOpenHint;
    expect(validateIpcArgs(ch, ['https://docs.claude.com/x'])).toBeNull();
    expect(validateIpcArgs(ch, ['kein-url'])).not.toBeNull();
  });

  it('logsTail: 1–5000', () => {
    const ch = DesktopIpcChannels.logsTail;
    expect(validateIpcArgs(ch, [500])).toBeNull();
    expect(validateIpcArgs(ch, [0])).not.toBeNull();
    expect(validateIpcArgs(ch, [5001])).not.toBeNull();
    expect(validateIpcArgs(ch, ['500'])).not.toBeNull();
  });

  it('logsReport: nur bekannte Report-Formen', () => {
    const ch = DesktopIpcChannels.logsReport;
    expect(validateIpcArgs(ch, [{ kind: 'error', message: 'kaputt' }])).toBeNull();
    expect(
      validateIpcArgs(ch, [{ kind: 'error', message: 'x', stack: 's', line: 1, column: 2 }]),
    ).toBeNull();
    expect(validateIpcArgs(ch, [{ kind: 'panik', message: 'x' }])).not.toBeNull();
  });

  it('projectsCreate/Update: Name + Vorlage bzw. striktes Teil-Update', () => {
    expect(
      validateIpcArgs(IpcChannels.projectsCreate, [{ name: 'Vereinsseite', templateId: 'basic' }]),
    ).toBeNull();
    expect(validateIpcArgs(IpcChannels.projectsCreate, [{ name: '' }])).not.toBeNull();
    expect(validateIpcArgs(IpcChannels.projectsUpdate, ['id1', { name: 'Neu' }])).toBeNull();
    expect(validateIpcArgs(IpcChannels.projectsUpdate, ['id1', { hack: true }])).not.toBeNull();
  });
});
