/**
 * „Fehler beheben"-Button (PLAN §4, Live-Preview): Ein `page-error` aus der
 * Vorschau wird in einen Chat-Turn geschrieben, den die KI beheben soll.
 *
 * Rein und headless testbar. Der Shim macht Pfade bereits projekt-relativ und
 * tilgt das Token; zur Sicherheit entfernt diese Funktion einen ggf. noch
 * enthaltenen Preview-Origin ein weiteres Mal.
 */

export interface PreviewPageError {
  message: string;
  stack?: string;
  source?: string;
}

/** Entfernt den Preview-Origin aus einem Text (macht Pfade projekt-relativ). */
function stripOrigin(text: string, origin?: string): string {
  if (origin === undefined || origin === '') return text;
  return text.split(`${origin}/`).join('').split(origin).join('');
}

/**
 * Baut den deutschen Prompt (Du-Form) aus Fehlermeldung, Quelle und Stack.
 * `previewOrigin` (z. B. `http://127.0.0.1:5173`) wird — falls angegeben — aus
 * allen Feldern getilgt, damit die Pfade projekt-relativ zu `site/` bleiben.
 */
export function buildErrorFixPrompt(error: PreviewPageError, previewOrigin?: string): string {
  const message = stripOrigin(error.message, previewOrigin).trim();
  const lines: string[] = [
    'In der Live-Vorschau ist ein Fehler aufgetreten. Bitte finde die Ursache und behebe sie in den Dateien unter site/.',
    '',
    'Fehlermeldung:',
    message.length > 0 ? message : '(keine Meldung)',
  ];

  const source = error.source ? stripOrigin(error.source, previewOrigin).trim() : '';
  if (source.length > 0) {
    lines.push('', `Quelle: ${source}`);
  }

  const stack = error.stack ? stripOrigin(error.stack, previewOrigin).trim() : '';
  if (stack.length > 0) {
    lines.push('', 'Stack:', stack);
  }

  return lines.join('\n');
}
