import { describe, expect, it } from 'vitest';

import { buildErrorFixPrompt } from './errorPrompt';

describe('buildErrorFixPrompt', () => {
  it('bündelt Meldung, Quelle und Stack in einen deutschen Prompt', () => {
    const prompt = buildErrorFixPrompt({
      message: 'x is not defined',
      source: 'site.js:12:3',
      stack: 'ReferenceError: x is not defined\n    at site.js:12:3',
    });
    expect(prompt).toContain('In der Live-Vorschau ist ein Fehler aufgetreten');
    expect(prompt).toContain('Fehlermeldung:\nx is not defined');
    expect(prompt).toContain('Quelle: site.js:12:3');
    expect(prompt).toContain('Stack:');
    expect(prompt).toContain('at site.js:12:3');
  });

  it('macht Pfade projekt-relativ (entfernt den Preview-Origin)', () => {
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
    expect(prompt).toContain('Quelle: scripts/app.js:1:1');
    expect(prompt).toContain('at scripts/app.js:1:1');
  });

  it('lässt optionale Felder weg, wenn sie fehlen', () => {
    const prompt = buildErrorFixPrompt({ message: 'Nur eine Meldung' });
    expect(prompt).toContain('Nur eine Meldung');
    expect(prompt).not.toContain('Quelle:');
    expect(prompt).not.toContain('Stack:');
  });

  it('kommt mit leerer Meldung zurecht', () => {
    const prompt = buildErrorFixPrompt({ message: '   ' });
    expect(prompt).toContain('(keine Meldung)');
  });
});
