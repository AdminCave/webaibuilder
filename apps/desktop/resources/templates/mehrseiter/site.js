// Multi-Page — shared script for all pages. Vanilla JS, no build step.

// Keep the year in the footer up to date.
document.querySelectorAll('[data-year]').forEach((el) => {
  el.textContent = String(new Date().getFullYear());
});
