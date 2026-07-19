# SITE.md — Blueprint of this site

This file is the map of the website for AI changes. Keep it up to date
as soon as pages or shared blocks are added.

## Technology

- Pure static HTML/CSS/JS — no build step, no dependencies.
- Do not include external resources (fonts, CDNs, trackers): the site stays
  self-contained and privacy-friendly.
- Colors and typography live in the CSS variables in `styles.css` (`:root`).

## Pages

| File         | Purpose                                     |
| ------------ | ------------------------------------------- |
| `index.html` | Home page — an intentionally blank starting point |

## Shared blocks

None yet. Once several pages exist: document the header/navigation and footer
here as shared blocks and keep them identical across all pages; move shared JS
into a `site.js` and include it on every page.

## Conventions

- Language: English, addressing the visitor directly. No emojis, no gradients.
- Dark design on black, hairline borders, exactly one accent blue (#4f9dff).
