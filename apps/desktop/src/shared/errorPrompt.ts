/**
 * "Fix error" button (PLAN §4, live preview): a `page-error` from the preview is
 * turned into a chat turn for the AI to fix.
 *
 * Pure and headless-testable. The shim already makes paths project-relative and
 * strips the token; as a safeguard, this function removes any still-present
 * preview origin one more time.
 */

export interface PreviewPageError {
  message: string;
  stack?: string;
  source?: string;
}

/** Removes the preview origin from a text (makes paths project-relative). */
function stripOrigin(text: string, origin?: string): string {
  if (origin === undefined || origin === '') return text;
  return text.split(`${origin}/`).join('').split(origin).join('');
}

/**
 * Builds the prompt from the error message, source, and stack. `previewOrigin`
 * (e.g. `http://127.0.0.1:5173`) — if provided — is stripped from all fields so
 * that the paths stay project-relative to `site/`.
 */
export function buildErrorFixPrompt(error: PreviewPageError, previewOrigin?: string): string {
  const message = stripOrigin(error.message, previewOrigin).trim();
  const lines: string[] = [
    'An error occurred in the live preview. Please find the cause and fix it in the files under site/.',
    '',
    'Error message:',
    message.length > 0 ? message : '(no message)',
  ];

  const source = error.source ? stripOrigin(error.source, previewOrigin).trim() : '';
  if (source.length > 0) {
    lines.push('', `Source: ${source}`);
  }

  const stack = error.stack ? stripOrigin(error.stack, previewOrigin).trim() : '';
  if (stack.length > 0) {
    lines.push('', 'Stack:', stack);
  }

  return lines.join('\n');
}
