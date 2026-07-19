/**
 * Deutsche, handlungsleitende Kurz-Hinweise für bekannte KI-Fehlerursachen
 * (PLAN §5: Du-Form). Rein (kein DOM/node/electron) — headless testbar.
 *
 * Bewusst renderer-seitig statt in den Adaptern: die Adapter liefern die echte
 * Ursache unverändert als `cause` (kein Informationsverlust), die UI übersetzt
 * bekannte Muster zusätzlich in einen verständlichen Hinweis. Die vollständige
 * Ursache bleibt in einem aufklappbaren Detailbereich sichtbar.
 */

/**
 * Erkennt bekannte Fehlermuster in Meldung + Ursache und liefert einen kurzen
 * deutschen Hinweis — oder `null`, wenn kein Muster passt (dann zeigt die UI
 * nur Meldung + Details).
 */
export function humanizeAgentError(details: string): string | null {
  const text = details.toLowerCase();
  if (/(^|\D)401(\D|$)|invalid x-api-key|authentication_error|unauthorized|api key/.test(text)) {
    return 'Dein API-Key wurde abgelehnt — prüfe ihn in den Einstellungen.';
  }
  if (/(^|\D)429(\D|$)|rate.?limit/.test(text)) {
    return 'Rate-Limit erreicht — warte einen Moment und versuch es dann erneut.';
  }
  if (/not_found_error|model.*not.*(found|exist|support)|unknown model/.test(text)) {
    return 'Das eingestellte Modell ist ungültig — prüfe die Modell-ID in den Einstellungen.';
  }
  if (/insufficient|credit balance|billing|quota/.test(text)) {
    return 'Dein Kontingent beim Anbieter scheint erschöpft — prüfe dort dein Konto.';
  }
  if (/enotfound|econnrefused|econnreset|etimedout|fetch failed|network error/.test(text)) {
    return 'Keine Verbindung zum Anbieter — prüfe deine Internetverbindung.';
  }
  return null;
}
