# SITE.md — Blueprint of this site

This file is the map of the website for AI changes. Keep it up to date
whenever pages, sections or shared blocks are added or change.

## Technology

- Pure static HTML/CSS/JS — no build step, no dependencies.
- Do not include external resources (fonts, CDNs, trackers): the site stays
  self-contained and privacy-friendly.
- Colors, radii and typography live in the CSS variables in `styles.css`
  (`:root`) — make design changes there, not in individual rules.

## Pages

| File         | Purpose                                                       |
| ------------ | ------------------------------------------------------------- |
| `index.html` | Single page: hero, offerings (cards), about, contact, footer  |

## Sections on index.html

- `#start` — hero with heading, lead text and two buttons
- `#angebot` — card grid (`.card-grid` > `.card`), one card per service
- `#ueber` — short about text
- `#kontakt` — contact via `mailto:` link (deliberately no form: no backend)

## Shared blocks (copy identically onto new pages)

- `<header class="site-header">` — brand name + anchor navigation
- `<footer class="site-footer">` — year (filled by `site.js` via `[data-year]`)
- `styles.css` and `site.js` are included by every page

## Conventions

- Language: English, addressing the visitor directly. No emojis, no gradients.
- Dark design on black, hairline borders, exactly one accent blue (#4f9dff).
- Replace placeholder text ("Your Name", "Service one", `hello@example.org`)
  with real content.
