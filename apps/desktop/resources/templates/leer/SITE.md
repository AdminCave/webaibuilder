# SITE.md — Bauplan dieser Seite

Diese Datei ist die Karte der Webseite für KI-Änderungen. Halte sie aktuell,
sobald Seiten oder gemeinsame Blöcke dazukommen.

## Technik

- Reines statisches HTML/CSS/JS — kein Build-Schritt, keine Abhängigkeiten.
- Keine externen Ressourcen (Fonts, CDNs, Tracker) einbinden: die Seite bleibt
  selbstständig und datenschutzfreundlich.
- Farben und Schrift hängen an den CSS-Variablen in `styles.css` (`:root`).

## Seiten

| Datei        | Zweck                                     |
| ------------ | ----------------------------------------- |
| `index.html` | Startseite — bewusst leerer Ausgangspunkt |

## Gemeinsame Blöcke

Noch keine. Sobald mehrere Seiten existieren: Header/Navigation und Footer als
gemeinsame Blöcke hier dokumentieren und auf allen Seiten identisch halten;
gemeinsames JS in eine `site.js` auslagern und auf jeder Seite einbinden.

## Konventionen

- Sprache: Deutsch, Besucher werden geduzt. Keine Emojis, keine Verläufe.
- Dunkles Design auf Schwarz, Hairline-Rahmen, genau ein Akzentblau (#4f9dff).
