/**
 * Headless-Tests der reinen Backend-Logik (PLAN §3/§4, M4): Kill-Switch-
 * Auflösung, Availability+Kill-Switch-Merge, Grouping/Label-Logik, der
 * Hinweis-Bestätigungs-Automat und die Onboarding-Link-Allowlist.
 *
 * Nur runtime-testbar (nicht hier): echtes CLI-Probing (detectBackends),
 * das tatsächliche Öffnen externer Links (shell.openExternal) und echte
 * Electron-IPC — dafür gibt es die Service-/Store-Tests mit injizierten Fakes.
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
  coerceKillSwitchConfig,
  coerceRawAvailability,
  isAllowedExternalUrl,
  isBackendSelectable,
  killSwitchFor,
  mergeAvailability,
  noticeGate,
  pickInstallHint,
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
/* Kill-Switch: Default, Validierung, Auflösung                        */
/* ------------------------------------------------------------------ */

describe('Kill-Switch — gebündelter Default', () => {
  it('hat alle vier Abo-Backends aktiv', () => {
    const effective = resolveKillSwitch(null);
    for (const id of ['claude-cli', 'codex', 'gemini-cli', 'grok-cli'] as const) {
      expect(killSwitchFor(effective, id).enabled).toBe(true);
    }
  });

  it('meldet API-Key-Backends immer als aktiv', () => {
    const effective = resolveKillSwitch(null);
    expect(killSwitchFor(effective, 'byok').enabled).toBe(true);
    expect(killSwitchFor(effective, 'claude-sdk').enabled).toBe(true);
  });
});

describe('coerceKillSwitchConfig — defensive Validierung', () => {
  it('liest eine gültige Remote-Config ein', () => {
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

  it('ignoriert unbekannte Backend-Schlüssel und Einträge ohne enabled', () => {
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

  it('gibt null zurück, wenn die Struktur kaputt ist (malformed → ignorieren)', () => {
    expect(coerceKillSwitchConfig(null)).toBeNull();
    expect(coerceKillSwitchConfig('kaputt')).toBeNull();
    expect(coerceKillSwitchConfig(42)).toBeNull();
    expect(coerceKillSwitchConfig({})).toBeNull(); // kein backends-Objekt
    expect(coerceKillSwitchConfig({ backends: null })).toBeNull();
  });
});

describe('resolveKillSwitch — Default vs. Remote-Override', () => {
  it('überschreibt ein Backend per Remote, andere bleiben Default', () => {
    const remote = coerceKillSwitchConfig({
      backends: { 'claude-cli': { enabled: false, reason: 'Über Nacht deaktiviert.' } },
    });
    const effective = resolveKillSwitch(remote);
    expect(killSwitchFor(effective, 'claude-cli')).toEqual({
      enabled: false,
      reason: 'Über Nacht deaktiviert.',
    });
    // Nicht überschriebene bleiben aktiv (Default).
    expect(killSwitchFor(effective, 'codex').enabled).toBe(true);
  });

  it('fällt bei null-Remote auf den reinen Default zurück', () => {
    expect(resolveKillSwitch(null).backends).toEqual(BUNDLED_KILLSWITCH.backends);
  });
});

/* ------------------------------------------------------------------ */
/* Availability + Kill-Switch-Merge                                    */
/* ------------------------------------------------------------------ */

describe('coerceRawAvailability — defensiv gegen Formänderungen', () => {
  it('liest die neue Form (backendId, loggedIn)', () => {
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

  it('akzeptiert auch die bestehende M2-Form (id)', () => {
    const parsed = coerceRawAvailability({ id: 'byok', installed: true, killSwitched: false });
    expect(parsed?.backendId).toBe('byok');
    expect(parsed?.loggedIn).toBe('unknown'); // kein loggedIn geliefert
  });

  it('gibt null für Unbekanntes/Fehlendes', () => {
    expect(coerceRawAvailability(null)).toBeNull();
    expect(coerceRawAvailability({ id: 'gibts-nicht' })).toBeNull();
    expect(coerceRawAvailability({})).toBeNull();
  });
});

describe('mergeAvailability — Kill-Switch + Metadaten', () => {
  it('meldet ein per Kill-Switch deaktiviertes Backend mit Grund', () => {
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

  it('markiert grok als experimentell — auch ohne Detection-Flag', () => {
    expect(viewOf('grok-cli').experimental).toBe(true);
    expect(viewOf('codex').experimental).toBe(false);
  });

  it('bevorzugt einen erlaubten Detection-Link, sonst den Fallback', () => {
    // Erlaubte Detection-URL wird übernommen.
    expect(viewOf('codex', { installHintUrl: 'https://openai.com/codex' }).installHintUrl).toBe(
      'https://openai.com/codex',
    );
    // Nicht erlaubte Detection-URL → Fallback (offizielle Vendor-Domain).
    const view = viewOf('codex', { installHintUrl: 'https://evil.example.com/x' });
    expect(view.installHintUrl).toBe('https://developers.openai.com/codex/cli/');
  });

  it('reicht den Kill-Switch-noticeMarkdown durch (auch bei aktivem Backend)', () => {
    const remote = coerceKillSwitchConfig({
      backends: { 'gemini-cli': { enabled: true, noticeMarkdown: 'Bitte CLI aktualisieren.' } },
    });
    expect(viewOf('gemini-cli', {}, resolveKillSwitch(remote)).noticeMarkdown).toBe(
      'Bitte CLI aktualisieren.',
    );
  });

  it('spiegelt den Bestätigungs-Zustand für claude-cli', () => {
    expect(viewOf('claude-cli').acknowledged).toBe(false);
    expect(viewOf('claude-cli', {}, resolveKillSwitch(null), new Set(['claude-cli'])).acknowledged).toBe(
      true,
    );
  });
});

describe('buildAvailabilityViews — immer alle sechs, geordnet', () => {
  it('ergänzt fehlende Backends defensiv als „nicht installiert"', () => {
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
/* Grouping + Status-Label + Auswählbarkeit                            */
/* ------------------------------------------------------------------ */

describe('Grouping', () => {
  it('teilt Abo- vs. API-Key-Backends korrekt', () => {
    expect(backendGroup('claude-cli')).toBe('subscription');
    expect(backendGroup('grok-cli')).toBe('subscription');
    expect(backendGroup('byok')).toBe('apikey');
    expect(backendGroup('claude-sdk')).toBe('apikey');
  });
});

describe('subscriptionStatusLabel', () => {
  it('liefert das richtige deutsche Label je Zustand', () => {
    expect(subscriptionStatusLabel(viewOf('codex', { installed: false }))).toBe('nicht installiert');
    expect(subscriptionStatusLabel(viewOf('codex', { installed: true, loggedIn: false }))).toBe(
      'gefunden · nicht eingeloggt',
    );
    expect(
      subscriptionStatusLabel(viewOf('codex', { installed: true, loggedIn: true, account: 'a@b.de' })),
    ).toBe('eingeloggt als a@b.de');
    expect(subscriptionStatusLabel(viewOf('codex', { installed: true, loggedIn: true }))).toBe(
      'gefunden · eingeloggt',
    );
    expect(subscriptionStatusLabel(viewOf('codex', { installed: true, loggedIn: 'unknown' }))).toBe(
      'gefunden',
    );
  });
});

describe('isBackendSelectable / backendBlockReason', () => {
  it('API-Key-Backends sind nie hier blockiert', () => {
    expect(isBackendSelectable(viewOf('byok', { installed: false }))).toBe(true);
    expect(backendBlockReason(viewOf('claude-sdk', { installed: false }))).toBeNull();
  });

  it('blockiert nicht installierte / nicht eingeloggte Abo-Backends', () => {
    expect(backendBlockReason(viewOf('codex', { installed: false }))).toBe('not-installed');
    expect(backendBlockReason(viewOf('codex', { installed: true, loggedIn: false }))).toBe(
      'not-logged-in',
    );
  });

  it('lässt ein bereites Abo-Backend ohne Hinweis zu (codex)', () => {
    expect(isBackendSelectable(viewOf('codex', { installed: true, loggedIn: true }))).toBe(true);
    // loggedIn 'unknown' blockiert nicht.
    expect(isBackendSelectable(viewOf('codex', { installed: true, loggedIn: 'unknown' }))).toBe(true);
  });

  it('verlangt für claude-cli erst die Bestätigung', () => {
    const notAcked = viewOf('claude-cli', { installed: true, loggedIn: true });
    expect(backendBlockReason(notAcked)).toBe('needs-ack');
    expect(isBackendSelectable(notAcked)).toBe(false);

    const acked = viewOf('claude-cli', { installed: true, loggedIn: true }, resolveKillSwitch(null), new Set(['claude-cli']));
    expect(isBackendSelectable(acked)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Aktivierung eines Abo-Backends als aktives Backend (Main-Gate-Logik) */
/* ------------------------------------------------------------------ */

describe('subscriptionActivationError — deutsche, handlungsleitende Meldung', () => {
  it('lässt ein bereites Abo-Backend zu (null)', () => {
    expect(subscriptionActivationError(viewOf('codex', { installed: true, loggedIn: true }))).toBeNull();
  });

  it('meldet „nicht installiert" mit Installationshinweis', () => {
    const msg = subscriptionActivationError(viewOf('codex', { installed: false }));
    expect(msg).toContain('nicht installiert');
    expect(msg).toContain('Codex CLI (OpenAI)');
  });

  it('meldet „nicht eingeloggt" mit Login-Hinweis', () => {
    const msg = subscriptionActivationError(viewOf('gemini-cli', { installed: true, loggedIn: false }));
    expect(msg).toContain('nicht eingeloggt');
    expect(msg).toContain('Melde dich');
  });

  it('meldet den Kill-Switch-Grund', () => {
    const remote = coerceKillSwitchConfig({
      backends: { 'grok-cli': { enabled: false, reason: 'xAI-Pfad pausiert.' } },
    });
    expect(
      subscriptionActivationError(viewOf('grok-cli', { installed: true, loggedIn: true }, resolveKillSwitch(remote))),
    ).toBe('xAI-Pfad pausiert.');
  });

  it('verlangt für claude-cli erst die Bestätigung', () => {
    const msg = subscriptionActivationError(viewOf('claude-cli', { installed: true, loggedIn: true }));
    expect(msg).toContain('Bestätige zuerst den Hinweis');
  });
});

describe('backendSelectAction — reine Picker-Klick-Entscheidung', () => {
  it('bereit → activate', () => {
    expect(backendSelectAction(viewOf('codex', { installed: true, loggedIn: true }))).toEqual({
      kind: 'activate',
    });
  });

  it('claude-cli ohne Bestätigung → acknowledge', () => {
    expect(backendSelectAction(viewOf('claude-cli', { installed: true, loggedIn: true }))).toEqual({
      kind: 'acknowledge',
    });
  });

  it('nicht installiert → blocked mit Hinweis + Onboarding-Link', () => {
    const action = backendSelectAction(viewOf('codex', { installed: false }));
    expect(action.kind).toBe('blocked');
    if (action.kind === 'blocked') {
      expect(action.message).toContain('installieren');
      expect(action.hintUrl).toBe('https://developers.openai.com/codex/cli/');
    }
  });
});

describe('activeBackendStatusLabel — Statusleisten-Label', () => {
  it('API-Key-Backend: Name plus „(kein Key)", wenn kein Key hinterlegt ist', () => {
    expect(activeBackendStatusLabel('byok', true)).toBe('Eigener API-Key');
    expect(activeBackendStatusLabel('byok', false)).toBe('Eigener API-Key (kein Key)');
    expect(activeBackendStatusLabel('claude-sdk', false)).toBe('Claude (Agent-SDK, API-Key) (kein Key)');
  });

  it('Abo-Backend: nur der Name, nie „(kein Key)" (Login liegt bei der CLI)', () => {
    expect(activeBackendStatusLabel('claude-cli', false)).toBe('Claude (Abo)');
    expect(activeBackendStatusLabel('codex', false)).toBe('Codex CLI (OpenAI)');
  });
});

/* ------------------------------------------------------------------ */
/* Hinweis-Bestätigungs-Automat                                        */
/* ------------------------------------------------------------------ */

describe('Notice-Ack-Automat', () => {
  it('noticeGate: no-notice / needs-ack / ready', () => {
    expect(noticeGate('codex', NONE)).toBe('no-notice');
    expect(noticeGate('byok', NONE)).toBe('no-notice');
    expect(noticeGate('claude-cli', NONE)).toBe('needs-ack');
    expect(noticeGate('claude-cli', new Set(['claude-cli']))).toBe('ready');
  });

  it('applyAck ist rein (mutiert die Eingabe nicht)', () => {
    const before: ReadonlySet<BackendId> = new Set();
    const after = applyAck(before, 'claude-cli');
    expect(before.has('claude-cli')).toBe(false);
    expect(after.has('claude-cli')).toBe(true);
  });

  it('ackFlowReducer: idle → showing → acknowledged; dismiss zurück nach idle', () => {
    expect(ackFlowReducer('idle', { type: 'open' })).toBe('showing');
    expect(ackFlowReducer('showing', { type: 'acknowledge' })).toBe('acknowledged');
    expect(ackFlowReducer('showing', { type: 'dismiss' })).toBe('idle');
    // acknowledged ist terminal.
    expect(ackFlowReducer('acknowledged', { type: 'open' })).toBe('acknowledged');
    expect(ackFlowReducer('acknowledged', { type: 'dismiss' })).toBe('acknowledged');
    // acknowledge nur aus showing.
    expect(ackFlowReducer('idle', { type: 'acknowledge' })).toBe('idle');
  });
});

/* ------------------------------------------------------------------ */
/* Onboarding-Link-Allowlist                                           */
/* ------------------------------------------------------------------ */

describe('isAllowedExternalUrl — nur offizielle Vendor-Domains (https)', () => {
  it('lässt offizielle Vendor-Domains zu', () => {
    expect(isAllowedExternalUrl('https://docs.claude.com/en/docs/claude-code/setup')).toBe(true);
    expect(isAllowedExternalUrl('https://www.anthropic.com/legal/consumer-terms')).toBe(true);
    expect(isAllowedExternalUrl('https://developers.openai.com/codex/cli/')).toBe(true);
    expect(isAllowedExternalUrl('https://ai.google.dev/gemini-api/docs')).toBe(true);
    expect(isAllowedExternalUrl('https://docs.x.ai/docs/overview')).toBe(true);
  });

  it('lehnt http, fremde Domains und Look-alikes ab', () => {
    expect(isAllowedExternalUrl('http://docs.claude.com/x')).toBe(false); // kein https
    expect(isAllowedExternalUrl('https://evil.example.com')).toBe(false);
    expect(isAllowedExternalUrl('https://claude.com.evil.com')).toBe(false); // Suffix-Trick
    expect(isAllowedExternalUrl('https://notclaude.com')).toBe(false);
    expect(isAllowedExternalUrl('nicht-mal-eine-url')).toBe(false);
  });

  it('pickInstallHint fällt bei nicht erlaubter Detection-URL auf den Fallback zurück', () => {
    expect(pickInstallHint('codex', 'https://openai.com/x')).toBe('https://openai.com/x');
    expect(pickInstallHint('codex', 'javascript:alert(1)')).toBe(
      'https://developers.openai.com/codex/cli/',
    );
    expect(pickInstallHint('byok')).toBeUndefined(); // API-Key-Backend hat keinen Hint
  });
});
