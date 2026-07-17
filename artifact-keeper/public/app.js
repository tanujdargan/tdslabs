// External so it works under the dashboard's strict CSP (no inline handlers).
// Confirm before submitting any form that carries a data-confirm message.
document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-confirm]');
  if (form && !window.confirm(form.getAttribute('data-confirm'))) {
    e.preventDefault();
  }
});
