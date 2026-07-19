import { describe, expect, it } from 'vitest';

import type { BackendPickerState } from './backends';
import {
  DesktopIpcChannels,
  DesktopIpcEvents,
  type ChatSendInput,
  type DeployProgressMessage,
  type DesktopIpcInvokeMap,
  type DesktopIpcEventMap,
  type LogLocation,
  type OpenHintResult,
  type SessionInfo,
} from './channels';
import type { DeployRunOutcome, DeployTargetInput } from './deploy';
import type { RendererErrorReport } from './logging';
import type { OnboardingState, OnboardingStateInput } from './onboarding';

describe('Desktop IPC channels', () => {
  it('are unique and follow the naming convention', () => {
    const names = [...Object.values(DesktopIpcChannels), ...Object.values(DesktopIpcEvents)];
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^wab:v\d+:[a-z]+:[a-z]+$/);
    }
  });

  it('do not collide with the core namespace prefix of the base channels', () => {
    // The base channels (core) use projects/templates/ping; the desktop channels
    // live in their own domains (session/chat/checkpoints/settings/event).
    for (const name of Object.values(DesktopIpcChannels)) {
      expect(name).not.toMatch(/:(projects|templates|ping):/);
    }
  });

  it('types payloads per channel (compile-time safety)', () => {
    // These assignments check the map at compile time; the runtime assert
    // keeps the test green.
    const send: ChatSendInput = { prompt: 'Hallo', runId: 'r1' };
    const openResult: DesktopIpcInvokeMap[typeof DesktopIpcChannels.sessionOpen]['result'] = {
      projectId: 'p1',
      preview: { url: 'http://127.0.0.1:1/?wab=t', port: 1, origin: 'http://127.0.0.1:1' },
      checkpoints: [],
    } satisfies SessionInfo;

    expect(send.runId).toBe('r1');
    expect(openResult.preview.port).toBe(1);
  });

  it('types the deploy channels (args/result + push payload)', () => {
    // Args of the save channel: [projectId, DeployTargetInput].
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

    // Result of the run channel: DeployRunOutcome (discriminated).
    const outcome: DesktopIpcInvokeMap[typeof DesktopIpcChannels.deployRun]['result'] = {
      status: 'error',
      message: 'x',
    } satisfies DeployRunOutcome;

    // Push payload of the deploy progress.
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

  it('types the onboarding and log channels (args/result, M5)', () => {
    // onboarding.get: no args, OnboardingState as result.
    const getArgs: DesktopIpcInvokeMap[typeof DesktopIpcChannels.onboardingGet]['args'] = [];
    const state: DesktopIpcInvokeMap[typeof DesktopIpcChannels.onboardingGet]['result'] = {
      hasOnboarded: true,
      completedAt: '2026-07-13T00:00:00.000Z',
    } satisfies OnboardingState;
    const setArgs: DesktopIpcInvokeMap[typeof DesktopIpcChannels.onboardingSet]['args'] = [
      { hasOnboarded: false } satisfies OnboardingStateInput,
    ];

    // logs.report: [RendererErrorReport]; logs.tail: [lines] → { text }.
    const reportArgs: DesktopIpcInvokeMap[typeof DesktopIpcChannels.logsReport]['args'] = [
      { kind: 'error', message: 'boom', line: 12 } satisfies RendererErrorReport,
    ];
    const tail: DesktopIpcInvokeMap[typeof DesktopIpcChannels.logsTail]['result'] = { text: 'z' };
    const info: DesktopIpcInvokeMap[typeof DesktopIpcChannels.logsInfo]['result'] = {
      dir: '/u/logs',
      file: '/u/logs/app.log',
    } satisfies LogLocation;

    expect(getArgs).toHaveLength(0);
    expect(state.hasOnboarded).toBe(true);
    expect(setArgs[0].hasOnboarded).toBe(false);
    expect(reportArgs[0].kind).toBe('error');
    expect(tail.text).toBe('z');
    expect(info.file).toContain('app.log');
  });

  it('types the backend channels (args/result, M4)', () => {
    // list/refresh: no args, BackendPickerState as result.
    const listArgs: DesktopIpcInvokeMap[typeof DesktopIpcChannels.backendsList]['args'] = [];
    const pickerState: DesktopIpcInvokeMap[typeof DesktopIpcChannels.backendsRefresh]['result'] = {
      backends: [],
      acknowledged: ['claude-cli'],
    } satisfies BackendPickerState;

    // ack: [BackendId]; openhint: [url] → { opened }.
    const ackArgs: DesktopIpcInvokeMap[typeof DesktopIpcChannels.backendsAck]['args'] = ['claude-cli'];
    const openArgs: DesktopIpcInvokeMap[typeof DesktopIpcChannels.backendsOpenHint]['args'] = [
      'https://docs.claude.com/en/docs/claude-code/setup',
    ];
    const openResult: DesktopIpcInvokeMap[typeof DesktopIpcChannels.backendsOpenHint]['result'] = {
      opened: true,
    } satisfies OpenHintResult;

    expect(listArgs).toHaveLength(0);
    expect(pickerState.acknowledged).toContain('claude-cli');
    expect(ackArgs[0]).toBe('claude-cli');
    expect(openArgs[0]).toContain('claude.com');
    expect(openResult.opened).toBe(true);
  });
});
