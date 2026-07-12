// Mehrseiter — gemeinsames Skript für alle Seiten. Vanilla-JS, kein Build-Schritt.

// Jahr in der Fußzeile aktuell halten.
document.querySelectorAll('[data-year]').forEach((el) => {
  el.textContent = String(new Date().getFullYear());
});
