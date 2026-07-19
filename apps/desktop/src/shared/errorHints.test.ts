/** Headless tests of the error-cause hints (pure pattern matching). */

import { describe, expect, it } from 'vitest';

import { humanizeAgentError } from './errorHints';

describe('humanizeAgentError', () => {
  it('detects rejected API keys (401/authentication)', () => {
    expect(humanizeAgentError('Request failed: 401 Unauthorized')).toMatch(/API key/);
    expect(humanizeAgentError('{"type":"authentication_error"}')).toMatch(/API key/);
    expect(humanizeAgentError('invalid x-api-key')).toMatch(/API key/);
  });

  it('detects rate limits', () => {
    expect(humanizeAgentError('429 Too Many Requests')).toMatch(/Rate limit/);
    expect(humanizeAgentError('rate_limit_error')).toMatch(/Rate limit/);
  });

  it('detects invalid models', () => {
    expect(humanizeAgentError('not_found_error: model claude-x')).toMatch(/model/);
    expect(humanizeAgentError('The model `foo` does not exist')).toMatch(/model/);
  });

  it('detects an exhausted quota', () => {
    expect(humanizeAgentError('Your credit balance is too low')).toMatch(/quota/);
  });

  it('detects network errors', () => {
    expect(humanizeAgentError('getaddrinfo ENOTFOUND api.anthropic.com')).toMatch(/connection/);
    expect(humanizeAgentError('TypeError: fetch failed')).toMatch(/connection/);
  });

  it('returns null for unknown input (no false confidence)', () => {
    expect(humanizeAgentError('irgendein anderer Fehler')).toBeNull();
    expect(humanizeAgentError('')).toBeNull();
    // "1401" or "4290" must not count as 401/429.
    expect(humanizeAgentError('code 1401')).toBeNull();
  });
});
