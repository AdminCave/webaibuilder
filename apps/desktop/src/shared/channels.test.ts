import { describe, expect, it } from 'vitest';

import {
  DesktopIpcChannels,
  DesktopIpcEvents,
  type ChatSendInput,
  type DesktopIpcInvokeMap,
  type SessionInfo,
} from './channels';

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
});
