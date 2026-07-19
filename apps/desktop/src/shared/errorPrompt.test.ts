import { describe, expect, it } from 'vitest';

import { buildErrorFixPrompt } from './errorPrompt';

describe('buildErrorFixPrompt', () => {
  it('bundles message, source, and stack into one prompt', () => {
    const prompt = buildErrorFixPrompt({
      message: 'x is not defined',
      source: 'site.js:12:3',
      stack: 'ReferenceError: x is not defined\n    at site.js:12:3',
    });
    expect(prompt).toContain('An error occurred in the live preview');
    expect(prompt).toContain('Error message:\nx is not defined');
    expect(prompt).toContain('Source: site.js:12:3');
    expect(prompt).toContain('Stack:');
    expect(prompt).toContain('at site.js:12:3');
  });

  it('makes paths project-relative (strips the preview origin)', () => {
    const origin = 'http://127.0.0.1:5173';
    const prompt = buildErrorFixPrompt(
      {
        message: 'Boom',
        source: `${origin}/scripts/app.js:1:1`,
        stack: `Error: Boom\n    at ${origin}/scripts/app.js:1:1`,
      },
      origin,
    );
    expect(prompt).not.toContain(origin);
    expect(prompt).toContain('Source: scripts/app.js:1:1');
    expect(prompt).toContain('at scripts/app.js:1:1');
  });

  it('omits optional fields when they are missing', () => {
    const prompt = buildErrorFixPrompt({ message: 'Just a message' });
    expect(prompt).toContain('Just a message');
    expect(prompt).not.toContain('Source:');
    expect(prompt).not.toContain('Stack:');
  });

  it('handles an empty message', () => {
    const prompt = buildErrorFixPrompt({ message: '   ' });
    expect(prompt).toContain('(no message)');
  });
});
