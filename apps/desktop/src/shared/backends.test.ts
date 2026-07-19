/**
 * Headless tests of the pure backend logic (PLAN §3/§4, M4): kill-switch
 * resolution, availability + kill-switch merge, grouping/label logic, the
 * notice acknowledgment state machine, and the onboarding link allowlist.
 *
 * Only runtime-testable (not here): real CLI probing (detectBackends), the
 * actual opening of external links (shell.openExternal), and real Electron
 * IPC — those are covered by the service/store tests with injected fakes.
 */

import { describe, expect, it } from 'vitest';

import type { BackendId } from '@webaibuilder/core';

import {
  ackFlowReducer,
  activeBackendStatusLabel,
  applyAck,
  backendBlockReason,
  backendGroup,
  backendSelectAction,
  buildAvailabilityViews,
  BUNDLED_KILLSWITCH,
  chatBlockReason,
  coerceKillSwitchConfig,
  coerceRawAvailability,
  isAllowedExternalUrl,
  isBackendSelectable,
  killSwitchFor,
  mergeAvailability,
  noticeGate,
  pickInstallHint,
  recommendChatSetup,
  resolveKillSwitch,
  subscriptionActivationError,
  subscriptionStatusLabel,
  type BackendAvailabilityView,
  type KillSwitchConfig,
  type RawBackendAvailability,
} from './backends';

const NONE: ReadonlySet<BackendId> = new Set();

function raw(id: BackendId, over: Partial<RawBackendAvailability> = {}): RawBackendAvailability {
  return { backendId: id, installed: true, loggedIn: true, ...over };
}

function viewOf(
  id: BackendId,
  over: Partial<RawBackendAvailability> = {},
  ks: KillSwitchConfig = resolveKillSwitch(null),
  acked: ReadonlySet<BackendId> = NONE,
): BackendAvailabilityView {
  return mergeAvailability(raw(id, over), ks, acked);
}

/* ------------------------------------------------------------------ */
/* Kill switch: default, validation, resolution                        */
/* ------------------------------------------------------------------ */

describe('Kill switch — bundled default', () => {
  it('has all four subscription backends active', () => {
    const effective = resolveKillSwitch(null);
    for (const id of ['claude-cli', 'codex', 'gemini-cli', 'grok-cli'] as const) {
      expect(killSwitchFor(effective, id).enabled).toBe(true);
    }
  });

  it('always reports API-key backends as active', () => {
    const effective = resolveKillSwitch(null);
    expect(killSwitchFor(effective, 'byok').enabled).toBe(true);
    expect(killSwitchFor(effective, 'claude-sdk').enabled).toBe(true);
  });
});

describe('coerceKillSwitchConfig — defensive validation', () => {
  it('reads a valid remote config', () => {
    const config = coerceKillSwitchConfig({
      version: 7,
      backends: {
        codex: { enabled: false, reason: 'Anbieter pausiert.', noticeMarkdown: 'Bald wieder da.' },
        'grok-cli': { enabled: true },
      },
    });
    expect(config).not.toBeNull();
    expect(config?.version).toBe(7);
    expect(config?.backends.codex).toEqual({
      enabled: false,
      reason: 'Anbieter pausiert.',
      noticeMarkdown: 'Bald wieder da.',
    });
  });

  it('ignores unknown backend keys and entries without enabled', () => {
    const config = coerceKillSwitchConfig({
      backends: {
        codex: { reason: 'kein enabled' },
        'gibts-nicht': { enabled: false },
      },
    });
    expect(config).not.toBeNull();
    expect(config?.backends.codex).toBeUndefined();
    expect(Object.keys(config?.backends ?? {})).toHaveLength(0);
  });

  it('returns null when the structure is broken (malformed → ignore)', () => {
    expect(coerceKillSwitchConfig(null)).toBeNull();
    expect(coerceKillSwitchConfig('kaputt')).toBeNull();
    expect(coerceKillSwitchConfig(42)).toBeNull();
    expect(coerceKillSwitchConfig({})).toBeNull(); // no backends object
    expect(coerceKillSwitchConfig({ backends: null })).toBeNull();
  });
});

describe('resolveKillSwitch — default vs. remote override', () => {
  it('overrides one backend via remote, others stay default', () => {
    const remote = coerceKillSwitchConfig({
      backends: { 'claude-cli': { enabled: false, reason: 'Über Nacht deaktiviert.' } },
    });
    const effective = resolveKillSwitch(remote);
    expect(killSwitchFor(effective, 'claude-cli')).toEqual({
      enabled: false,
      reason: 'Über Nacht deaktiviert.',
    });
    // Non-overridden ones stay active (default).
    expect(killSwitchFor(effective, 'codex').enabled).toBe(true);
  });

  it('falls back to the pure default on a null remote', () => {
    expect(resolveKillSwitch(null).backends).toEqual(BUNDLED_KILLSWITCH.backends);
  });
});

/* ------------------------------------------------------------------ */
/* Availability + kill-switch merge                                    */
/* ------------------------------------------------------------------ */

describe('coerceRawAvailability — defensive against shape changes', () => {
  it('reads the new shape (backendId, loggedIn)', () => {
    expect(
      coerceRawAvailability({
        backendId: 'codex',
        installed: true,
        loggedIn: false,
        installHintUrl: 'https://developers.openai.com/codex/cli/',
        experimental: true,
      }),
    ).toEqual({
      backendId: 'codex',
      installed: true,
      loggedIn: false,
      installHintUrl: 'https://developers.openai.com/codex/cli/',
      experimental: true,
    });
  });

  it('also accepts the existing M2 shape (id)', () => {
    const parsed = coerceRawAvailability({ id: 'byok', installed: true, killSwitched: false });
    expect(parsed?.backendId).toBe('byok');
    expect(parsed?.loggedIn).toBe('unknown'); // no loggedIn provided
  });

  it('returns null for unknown/missing input', () => {
    expect(coerceRawAvailability(null)).toBeNull();
    expect(coerceRawAvailability({ id: 'gibts-nicht' })).toBeNull();
    expect(coerceRawAvailability({})).toBeNull();
  });
});

describe('mergeAvailability — kill switch + metadata', () => {
  it('reports a kill-switch-disabled backend with a reason', () => {
    const remote = coerceKillSwitchConfig({
      backends: { codex: { enabled: false, reason: 'Codex pausiert.' } },
    });
    const view = viewOf('codex', {}, resolveKillSwitch(remote));
    expect(view.enabled).toBe(false);
    expect(view.disabledReason).toBe('Codex pausiert.');
    expect(isBackendSelectable(view)).toBe(false);
    expect(backendBlockReason(view)).toBe('kill-switch');
    expect(subscriptionStatusLabel(view)).toBe('Codex pausiert.');
  });

  it('marks grok as experimental — even without a detection flag', () => {
    expect(viewOf('grok-cli').experimental).toBe(true);
    expect(viewOf('codex').experimental).toBe(false);
  });

  it('prefers an allowed detection link, otherwise the fallback', () => {
    // An allowed detection URL is adopted.
    expect(viewOf('codex', { installHintUrl: 'https://openai.com/codex' }).installHintUrl).toBe(
      'https://openai.com/codex',
    );
    // Disallowed detection URL → fallback (official vendor domain).
    const view = viewOf('codex', { installHintUrl: 'https://evil.example.com/x' });
    expect(view.installHintUrl).toBe('https://developers.openai.com/codex/cli/');
  });

  it('passes the kill-switch noticeMarkdown through (even for an active backend)', () => {
    const remote = coerceKillSwitchConfig({
      backends: { 'gemini-cli': { enabled: true, noticeMarkdown: 'Bitte CLI aktualisieren.' } },
    });
    expect(viewOf('gemini-cli', {}, resolveKillSwitch(remote)).noticeMarkdown).toBe(
      'Bitte CLI aktualisieren.',
    );
  });

  it('mirrors the acknowledgment state for claude-cli', () => {
    expect(viewOf('claude-cli').acknowledged).toBe(false);
    expect(viewOf('claude-cli', {}, resolveKillSwitch(null), new Set(['claude-cli'])).acknowledged).toBe(
      true,
    );
  });
});

describe('buildAvailabilityViews — always all six, ordered', () => {
  it('defensively adds missing backends as not installed', () => {
    const views = buildAvailabilityViews([raw('byok', { installed: true })], resolveKillSwitch(null), NONE);
    expect(views.map((v) => v.backendId)).toEqual([
      'byok',
      'claude-sdk',
      'claude-cli',
      'codex',
      'gemini-cli',
      'grok-cli',
    ]);
    expect(views.find((v) => v.backendId === 'codex')?.installed).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Grouping + status label + selectability                             */
/* ------------------------------------------------------------------ */

describe('Grouping', () => {
  it('splits subscription vs. API-key backends correctly', () => {
    expect(backendGroup('claude-cli')).toBe('subscription');
    expect(backendGroup('grok-cli')).toBe('subscription');
    expect(backendGroup('byok')).toBe('apikey');
    expect(backendGroup('claude-sdk')).toBe('apikey');
  });
});

describe('subscriptionStatusLabel', () => {
  it('returns the correct label per state', () => {
    expect(subscriptionStatusLabel(viewOf('codex', { installed: false }))).toBe('not installed');
    expect(subscriptionStatusLabel(viewOf('codex', { installed: true, loggedIn: false }))).toBe(
      'found · not logged in',
    );
    expect(
      subscriptionStatusLabel(viewOf('codex', { installed: true, loggedIn: true, account: 'a@b.de' })),
    ).toBe('logged in as a@b.de');
    expect(subscriptionStatusLabel(viewOf('codex', { installed: true, loggedIn: true }))).toBe(
      'found · logged in',
    );
    expect(subscriptionStatusLabel(viewOf('codex', { installed: true, loggedIn: 'unknown' }))).toBe(
      'found',
    );
  });
});

describe('isBackendSelectable / backendBlockReason', () => {
  it('API-key backends are never blocked here', () => {
    expect(isBackendSelectable(viewOf('byok', { installed: false }))).toBe(true);
    expect(backendBlockReason(viewOf('claude-sdk', { installed: false }))).toBeNull();
  });

  it('blocks not-installed / not-logged-in subscription backends', () => {
    expect(backendBlockReason(viewOf('codex', { installed: false }))).toBe('not-installed');
    expect(backendBlockReason(viewOf('codex', { installed: true, loggedIn: false }))).toBe(
      'not-logged-in',
    );
  });

  it('allows a ready subscription backend without a notice (codex)', () => {
    expect(isBackendSelectable(viewOf('codex', { installed: true, loggedIn: true }))).toBe(true);
    // loggedIn 'unknown' does not block.
    expect(isBackendSelectable(viewOf('codex', { installed: true, loggedIn: 'unknown' }))).toBe(true);
  });

  it('requires acknowledgment first for claude-cli', () => {
    const notAcked = viewOf('claude-cli', { installed: true, loggedIn: true });
    expect(backendBlockReason(notAcked)).toBe('needs-ack');
    expect(isBackendSelectable(notAcked)).toBe(false);

    const acked = viewOf('claude-cli', { installed: true, loggedIn: true }, resolveKillSwitch(null), new Set(['claude-cli']));
    expect(isBackendSelectable(acked)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Activating a subscription backend as the active backend (main gate) */
/* ------------------------------------------------------------------ */

describe('subscriptionActivationError — actionable message', () => {
  it('allows a ready subscription backend (null)', () => {
    expect(subscriptionActivationError(viewOf('codex', { installed: true, loggedIn: true }))).toBeNull();
  });

  it('reports "not installed" with an install hint', () => {
    const msg = subscriptionActivationError(viewOf('codex', { installed: false }));
    expect(msg).toContain('not installed');
    expect(msg).toContain('Codex CLI (OpenAI)');
  });

  it('reports "not signed in" with a sign-in hint', () => {
    const msg = subscriptionActivationError(viewOf('gemini-cli', { installed: true, loggedIn: false }));
    expect(msg).toContain('not signed in');
    expect(msg).toContain('Sign in');
  });

  it('reports the kill-switch reason', () => {
    const remote = coerceKillSwitchConfig({
      backends: { 'grok-cli': { enabled: false, reason: 'xAI-Pfad pausiert.' } },
    });
    expect(
      subscriptionActivationError(viewOf('grok-cli', { installed: true, loggedIn: true }, resolveKillSwitch(remote))),
    ).toBe('xAI-Pfad pausiert.');
  });

  it('requires acknowledgment first for claude-cli', () => {
    const msg = subscriptionActivationError(viewOf('claude-cli', { installed: true, loggedIn: true }));
    expect(msg).toContain('Acknowledge the notice');
  });
});

describe('backendSelectAction — pure picker-click decision', () => {
  it('ready → activate', () => {
    expect(backendSelectAction(viewOf('codex', { installed: true, loggedIn: true }))).toEqual({
      kind: 'activate',
    });
  });

  it('claude-cli without acknowledgment → acknowledge', () => {
    expect(backendSelectAction(viewOf('claude-cli', { installed: true, loggedIn: true }))).toEqual({
      kind: 'acknowledge',
    });
  });

  it('not installed → blocked with a hint + onboarding link', () => {
    const action = backendSelectAction(viewOf('codex', { installed: false }));
    expect(action.kind).toBe('blocked');
    if (action.kind === 'blocked') {
      expect(action.message).toContain('Install');
      expect(action.hintUrl).toBe('https://developers.openai.com/codex/cli/');
    }
  });
});

describe('activeBackendStatusLabel — status-bar label', () => {
  it('API-key backend: name plus (no key) when no key is stored', () => {
    expect(activeBackendStatusLabel('byok', true)).toBe('Your own API key');
    expect(activeBackendStatusLabel('byok', false)).toBe('Your own API key (no key)');
    expect(activeBackendStatusLabel('claude-sdk', false)).toBe('Claude (Agent SDK, API key) (no key)');
  });

  it('subscription backend: only the name, never (no key) (login is handled by the CLI)', () => {
    expect(activeBackendStatusLabel('claude-cli', false)).toBe('Claude (subscription)');
    expect(activeBackendStatusLabel('codex', false)).toBe('Codex CLI (OpenAI)');
  });
});

/* ------------------------------------------------------------------ */
/* Notice acknowledgment state machine                                 */
/* ------------------------------------------------------------------ */

describe('Notice acknowledgment state machine', () => {
  it('noticeGate: no-notice / needs-ack / ready', () => {
    expect(noticeGate('codex', NONE)).toBe('no-notice');
    expect(noticeGate('byok', NONE)).toBe('no-notice');
    expect(noticeGate('claude-cli', NONE)).toBe('needs-ack');
    expect(noticeGate('claude-cli', new Set(['claude-cli']))).toBe('ready');
  });

  it('applyAck is pure (does not mutate the input)', () => {
    const before: ReadonlySet<BackendId> = new Set();
    const after = applyAck(before, 'claude-cli');
    expect(before.has('claude-cli')).toBe(false);
    expect(after.has('claude-cli')).toBe(true);
  });

  it('ackFlowReducer: idle → showing → acknowledged; dismiss back to idle', () => {
    expect(ackFlowReducer('idle', { type: 'open' })).toBe('showing');
    expect(ackFlowReducer('showing', { type: 'acknowledge' })).toBe('acknowledged');
    expect(ackFlowReducer('showing', { type: 'dismiss' })).toBe('idle');
    // acknowledged is terminal.
    expect(ackFlowReducer('acknowledged', { type: 'open' })).toBe('acknowledged');
    expect(ackFlowReducer('acknowledged', { type: 'dismiss' })).toBe('acknowledged');
    // acknowledge only from showing.
    expect(ackFlowReducer('idle', { type: 'acknowledge' })).toBe('idle');
  });
});

/* ------------------------------------------------------------------ */
/* Onboarding link allowlist                                           */
/* ------------------------------------------------------------------ */

describe('isAllowedExternalUrl — official vendor domains only (https)', () => {
  it('allows official vendor domains', () => {
    expect(isAllowedExternalUrl('https://docs.claude.com/en/docs/claude-code/setup')).toBe(true);
    expect(isAllowedExternalUrl('https://www.anthropic.com/legal/consumer-terms')).toBe(true);
    expect(isAllowedExternalUrl('https://developers.openai.com/codex/cli/')).toBe(true);
    expect(isAllowedExternalUrl('https://ai.google.dev/gemini-api/docs')).toBe(true);
    expect(isAllowedExternalUrl('https://docs.x.ai/docs/overview')).toBe(true);
  });

  it('rejects http, foreign domains, and look-alikes', () => {
    expect(isAllowedExternalUrl('http://docs.claude.com/x')).toBe(false); // not https
    expect(isAllowedExternalUrl('https://evil.example.com')).toBe(false);
    expect(isAllowedExternalUrl('https://claude.com.evil.com')).toBe(false); // suffix trick
    expect(isAllowedExternalUrl('https://notclaude.com')).toBe(false);
    expect(isAllowedExternalUrl('nicht-mal-eine-url')).toBe(false);
  });

  it('pickInstallHint falls back to the fallback for a disallowed detection URL', () => {
    expect(pickInstallHint('codex', 'https://openai.com/x')).toBe('https://openai.com/x');
    expect(pickInstallHint('codex', 'javascript:alert(1)')).toBe(
      'https://developers.openai.com/codex/cli/',
    );
    expect(pickInstallHint('byok')).toBeUndefined(); // API-key backend has no hint
  });
});

/* ------------------------------------------------------------------ */
/* Chat readiness (chatBlockReason)                                    */
/* ------------------------------------------------------------------ */

describe('chatBlockReason — unlocking the composer', () => {
  it('null settings block with no-settings', () => {
    expect(chatBlockReason(null)).toBe('no-settings');
  });

  it('API-key backends need a key (keychain or environment = hasApiKey)', () => {
    expect(chatBlockReason({ backendId: 'byok', hasApiKey: false })).toBe('missing-key');
    expect(chatBlockReason({ backendId: 'byok', hasApiKey: true })).toBeNull();
    expect(chatBlockReason({ backendId: 'claude-sdk', hasApiKey: false })).toBe('missing-key');
    expect(chatBlockReason({ backendId: 'claude-sdk', hasApiKey: true })).toBeNull();
  });

  it('subscription backends are always ready as the active backend (main checked activation)', () => {
    expect(chatBlockReason({ backendId: 'claude-cli', hasApiKey: false })).toBeNull();
    expect(chatBlockReason({ backendId: 'codex', hasApiKey: false })).toBeNull();
    expect(chatBlockReason({ backendId: 'gemini-cli', hasApiKey: false })).toBeNull();
    expect(chatBlockReason({ backendId: 'grok-cli', hasApiKey: false })).toBeNull();
  });
});

describe('recommendChatSetup — recommendation for the chat empty-state', () => {
  const KS = resolveKillSwitch(null);

  it('recommends the first installed subscription backend (claude-cli before codex)', () => {
    const views = buildAvailabilityViews(
      [raw('claude-cli', { loggedIn: 'unknown' }), raw('codex')],
      KS,
      NONE,
    );
    expect(recommendChatSetup(views)).toEqual({
      kind: 'use-subscription',
      backendId: 'claude-cli',
      needsAck: true, // notice not acknowledged yet
    });
  });

  it('needsAck is false when the notice was already acknowledged', () => {
    const views = buildAvailabilityViews([raw('claude-cli')], KS, new Set(['claude-cli']));
    expect(recommendChatSetup(views)).toEqual({
      kind: 'use-subscription',
      backendId: 'claude-cli',
      needsAck: false,
    });
  });

  it('skips not-installed, logged-out, kill-switched, and experimental backends', () => {
    const remote = coerceKillSwitchConfig({
      backends: { codex: { enabled: false, reason: 'pausiert' } },
    });
    const views = buildAvailabilityViews(
      [
        raw('claude-cli', { installed: false }),
        raw('codex'), // kill-switched
        raw('gemini-cli', { loggedIn: false }), // logged out
        raw('grok-cli'), // experimental
      ],
      resolveKillSwitch(remote),
      NONE,
    );
    expect(recommendChatSetup(views)).toEqual({ kind: 'enter-key' });
  });

  it('empty detection → API-key path', () => {
    expect(recommendChatSetup([])).toEqual({ kind: 'enter-key' });
    expect(recommendChatSetup(buildAvailabilityViews([], KS, NONE))).toEqual({
      kind: 'enter-key',
    });
  });
});
