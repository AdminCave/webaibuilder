// One-Pager — shared script. Plain vanilla JS, no build step.

// Keep the year in the footer up to date.
document.querySelectorAll('[data-year]').forEach((el) => {
  el.textContent = String(new Date().getFullYear());
});
