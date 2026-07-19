/**
 * Short, actionable hints for known AI error causes (PLAN §5). Pure (no
 * DOM/node/electron) — headless-testable.
 *
 * Deliberately on the renderer side instead of in the adapters: the adapters pass
 * the real cause through unchanged as `cause` (no loss of information), and the UI
 * additionally translates known patterns into an understandable hint. The full
 * cause stays visible in an expandable detail section.
 */

/**
 * Detects known error patterns in message + cause and returns a short hint — or
 * `null` when no pattern matches (in which case the UI only shows message +
 * details).
 */
export function humanizeAgentError(details: string): string | null {
  const text = details.toLowerCase();
  if (/(^|\D)401(\D|$)|invalid x-api-key|authentication_error|unauthorized|api key/.test(text)) {
    return 'Your API key was rejected — check it in Settings.';
  }
  if (/(^|\D)429(\D|$)|rate.?limit/.test(text)) {
    return 'Rate limit reached — wait a moment, then try again.';
  }
  if (/not_found_error|model.*not.*(found|exist|support)|unknown model/.test(text)) {
    return 'The configured model is invalid — check the model ID in Settings.';
  }
  if (/insufficient|credit balance|billing|quota/.test(text)) {
    return 'Your quota with the provider appears to be exhausted — check your account there.';
  }
  if (/enotfound|econnrefused|econnreset|etimedout|fetch failed|network error/.test(text)) {
    return 'No connection to the provider — check your internet connection.';
  }
  return null;
}
