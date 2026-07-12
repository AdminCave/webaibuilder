import { describe, expect, it } from 'vitest';

import {
  DesktopIpcChannels,
  DesktopIpcEvents,
  type ChatSendInput,
  type DeployProgressMessage,
  type DesktopIpcEventMap,
  type DesktopIpcInvokeMap,
  type SessionInfo,
} from './channels';
import type { DeployRunOutcome, DeployTargetInput } from './deploy';

describe('Desktop-IPC-Kanäle', () => {
  it('sind eindeutig und folgen der Namenskonvention', () => {
    const names = [...Object.values(DesktopIpcChannels), ...Object.values(DesktopIpcEvents)];
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^wab:v\d+:[a-z]+:[a-z]+$/);
    }
  });

  it('kollidieren nicht mit dem core-Namensraum-Präfix der Basis-Kanäle', () => {
    // Basis-Kanäle (core) nutzen projects/templates/ping; die Desktop-Kanäle
    // liegen in eigenen Domänen (session/chat/checkpoints/settings/event).
    for (const name of Object.values(DesktopIpcChannels)) {
      expect(name).not.toMatch(/:(projects|templates|ping):/);
    }
  });

  it('typisiert Nutzlasten pro Kanal (Compile-Time-Absicherung)', () => {
    // Diese Zuweisungen prüfen die Map zur Compile-Zeit; der Laufzeit-Assert
    // hält den Test „grün".
    const send: ChatSendInput = { prompt: 'Hallo', runId: 'r1' };
    const openResult: DesktopIpcInvokeMap[typeof DesktopIpcChannels.sessionOpen]['result'] = {
      projectId: 'p1',
      preview: { url: 'http://127.0.0.1:1/?wab=t', port: 1, origin: 'http://127.0.0.1:1' },
      checkpoints: [],
    } satisfies SessionInfo;

    expect(send.runId).toBe('r1');
    expect(openResult.preview.port).toBe(1);
  });

  it('typisiert die Deploy-Kanäle (Args/Result + Push-Nutzlast)', () => {
    // Args des Save-Kanals: [projectId, DeployTargetInput].
    const saveArgs: DesktopIpcInvokeMap[typeof DesktopIpcChannels.deployTargetsSave]['args'] = [
      'p1',
      {
        name: 'IONOS',
        protocol: 'sftp',
        host: 'ssh.example.org',
        port: 22,
        username: 'w0',
        remotePath: '/htdocs',
        password: 'geheim',
      } satisfies DeployTargetInput,
    ];

    // Result des Run-Kanals: DeployRunOutcome (diskriminiert).
    const outcome: DesktopIpcInvokeMap[typeof DesktopIpcChannels.deployRun]['result'] = {
      status: 'error',
      message: 'x',
    } satisfies DeployRunOutcome;

    // Push-Nutzlast des Deploy-Fortschritts.
    const progress: DesktopIpcEventMap[typeof DesktopIpcEvents.deploy] = {
      projectId: 'p1',
      targetId: 't1',
      runId: 'r1',
      event: { type: 'connecting' },
    } satisfies DeployProgressMessage;

    expect(saveArgs[0]).toBe('p1');
    expect(outcome.status).toBe('error');
    expect(progress.event.type).toBe('connecting');
  });
});
