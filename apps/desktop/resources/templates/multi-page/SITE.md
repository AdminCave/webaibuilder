# SITE.md — Blueprint of this site

This file is the map of the website for AI changes. Keep it up to date
whenever pages are added, removed or shared blocks change.

## Technology

- Pure static HTML/CSS/JS — no build step, no dependencies.
- Do not include external resources (fonts, CDNs, trackers): the site stays
  self-contained and privacy-friendly.
- Colors, radii and typography live in the CSS variables in `styles.css`
  (`:root`) — make design changes there, not in individual rules.

## Pages

| File           | Purpose                                            |
| -------------- | -------------------------------------------------- |
| `index.html`   | Home page: greeting, intro, most important topic   |
| `about.html`   | About page: story, principles                      |
| `contact.html` | Contact: email, phone, address                     |

## Shared blocks — keep in sync across ALL pages

These blocks appear verbatim in every HTML file. Whoever changes one of them
(e.g. adds a new page to the navigation) must change it identically in **all**
pages:

- `<header class="site-header">` — brand name + navigation.
  The current page gets `aria-current="page"` on its nav link
  (styling: weight + underline, not a filled pill).
- `<footer class="site-footer">` — year (filled by `site.js` via `[data-year]`)
  and contact link.
- `<head>`: `styles.css` and `site.js` (with `defer`) are included by every
  page.

## Adding a new page — checklist

1. Copy an existing page (e.g. `about.html`); replace the title, description and
   the content in `<main class="page">`.
2. Add the nav link to **all** pages; set `aria-current="page"` only on the
   new page.
3. Add a row to this table in SITE.md.

## Conventions

- Language: English, addressing the visitor directly. No emojis, no gradients.
- Dark design on black, hairline borders, exactly one accent blue (#4f9dff).
- Contact via `mailto:`/`tel:` link — deliberately no form (no backend).
- Replace placeholders ("Your Name", `hello@example.org`, Example Street) with
  real content.
