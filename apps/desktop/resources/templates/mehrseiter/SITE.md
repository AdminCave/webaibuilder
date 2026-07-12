# SITE.md — Bauplan dieser Seite

Diese Datei ist die Karte der Webseite für KI-Änderungen. Halte sie aktuell,
wenn Seiten dazukommen, wegfallen oder sich gemeinsame Blöcke ändern.

## Technik

- Reines statisches HTML/CSS/JS — kein Build-Schritt, keine Abhängigkeiten.
- Keine externen Ressourcen (Fonts, CDNs, Tracker) einbinden: die Seite bleibt
  selbstständig und datenschutzfreundlich.
- Farben, Radien und Schrift hängen an den CSS-Variablen in `styles.css`
  (`:root`) — Design-Änderungen dort vornehmen, nicht in einzelnen Regeln.

## Seiten

| Datei          | Zweck                                              |
| -------------- | -------------------------------------------------- |
| `index.html`   | Startseite: Begrüßung, Einstieg, wichtigstes Thema |
| `ueber.html`   | Über-Seite: Geschichte, Grundsätze                 |
| `kontakt.html` | Kontakt: E-Mail, Telefon, Anschrift                |

## Gemeinsame Blöcke — auf ALLEN Seiten synchron halten

Diese Blöcke stehen wörtlich in jeder HTML-Datei. Wer einen davon ändert
(z. B. eine neue Seite in die Navigation aufnimmt), muss ihn in **allen**
Seiten gleich ändern:

- `<header class="site-header">` — Markenname + Navigation.
  Die jeweils aktive Seite bekommt `aria-current="page"` an ihrem Nav-Link
  (Styling: Gewicht + Unterstrich, keine gefüllte Pille).
- `<footer class="site-footer">` — Jahr (füllt `site.js` über `[data-year]`)
  und Kontakt-Link.
- `<head>`: `styles.css` und `site.js` (mit `defer`) werden von jeder Seite
  eingebunden.

## Neue Seite anlegen — Checkliste

1. Bestehende Seite kopieren (z. B. `ueber.html`); Titel, Beschreibung und
   den Inhalt in `<main class="page">` ersetzen.
2. Nav-Link in **allen** Seiten ergänzen; `aria-current="page"` nur auf der
   neuen Seite setzen.
3. Diese Tabelle in SITE.md ergänzen.

## Konventionen

- Sprache: Deutsch, Besucher werden geduzt. Keine Emojis, keine Verläufe.
- Dunkles Design auf Schwarz, Hairline-Rahmen, genau ein Akzentblau (#4f9dff).
- Kontakt per `mailto:`/`tel:`-Link — bewusst kein Formular (kein Backend).
- Platzhalter ("Dein Name", `hallo@example.org`, Musterstraße) durch echte
  Inhalte ersetzen.
