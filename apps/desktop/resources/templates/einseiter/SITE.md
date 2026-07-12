# SITE.md — Bauplan dieser Seite

Diese Datei ist die Karte der Webseite für KI-Änderungen. Halte sie aktuell,
wenn Seiten, Abschnitte oder gemeinsame Blöcke dazukommen oder sich ändern.

## Technik

- Reines statisches HTML/CSS/JS — kein Build-Schritt, keine Abhängigkeiten.
- Keine externen Ressourcen (Fonts, CDNs, Tracker) einbinden: die Seite bleibt
  selbstständig und datenschutzfreundlich.
- Farben, Radien und Schrift hängen an den CSS-Variablen in `styles.css`
  (`:root`) — Design-Änderungen dort vornehmen, nicht in einzelnen Regeln.

## Seiten

| Datei        | Zweck                                                        |
| ------------ | ------------------------------------------------------------ |
| `index.html` | Einzige Seite: Hero, Angebot (Karten), Über, Kontakt, Footer |

## Abschnitte auf index.html

- `#start` — Hero mit Überschrift, Lead-Text und zwei Buttons
- `#angebot` — Karten-Grid (`.card-grid` > `.card`), pro Leistung eine Karte
- `#ueber` — kurzer Über-Text
- `#kontakt` — Kontakt per `mailto:`-Link (bewusst kein Formular: kein Backend)

## Gemeinsame Blöcke (bei neuen Seiten identisch übernehmen)

- `<header class="site-header">` — Markenname + Anker-Navigation
- `<footer class="site-footer">` — Jahr (füllt `site.js` über `[data-year]`)
- `styles.css` und `site.js` werden von jeder Seite eingebunden

## Konventionen

- Sprache: Deutsch, Besucher werden geduzt. Keine Emojis, keine Verläufe.
- Dunkles Design auf Schwarz, Hairline-Rahmen, genau ein Akzentblau (#4f9dff).
- Platzhaltertexte ("Dein Name", "Leistung eins", `hallo@example.org`) durch
  echte Inhalte ersetzen.
