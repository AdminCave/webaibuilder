/** Headless-Tests der Fehlerursachen-Hinweise (reine Mustererkennung). */

import { describe, expect, it } from 'vitest';

import { humanizeAgentError } from './errorHints';

describe('humanizeAgentError', () => {
  it('erkennt abgelehnte API-Keys (401/authentication)', () => {
    expect(humanizeAgentError('Request failed: 401 Unauthorized')).toMatch(/API-Key/);
    expect(humanizeAgentError('{"type":"authentication_error"}')).toMatch(/API-Key/);
    expect(humanizeAgentError('invalid x-api-key')).toMatch(/API-Key/);
  });

  it('erkennt Rate-Limits', () => {
    expect(humanizeAgentError('429 Too Many Requests')).toMatch(/Rate-Limit/);
    expect(humanizeAgentError('rate_limit_error')).toMatch(/Rate-Limit/);
  });

  it('erkennt ungültige Modelle', () => {
    expect(humanizeAgentError('not_found_error: model claude-x')).toMatch(/Modell/);
    expect(humanizeAgentError('The model `foo` does not exist')).toMatch(/Modell/);
  });

  it('erkennt erschöpftes Kontingent', () => {
    expect(humanizeAgentError('Your credit balance is too low')).toMatch(/Kontingent/);
  });

  it('erkennt Netzwerkfehler', () => {
    expect(humanizeAgentError('getaddrinfo ENOTFOUND api.anthropic.com')).toMatch(/Verbindung/);
    expect(humanizeAgentError('TypeError: fetch failed')).toMatch(/Verbindung/);
  });

  it('liefert null für Unbekanntes (keine falsche Sicherheit)', () => {
    expect(humanizeAgentError('irgendein anderer Fehler')).toBeNull();
    expect(humanizeAgentError('')).toBeNull();
    // "1401" oder "4290" dürfen nicht als 401/429 zählen.
    expect(humanizeAgentError('code 1401')).toBeNull();
  });
});
