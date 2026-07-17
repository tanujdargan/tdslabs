// External so it works under the dashboard's strict CSP (no inline handlers).
// Confirm before submitting any form that carries a data-confirm message.
document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-confirm]');
  if (form && !window.confirm(form.getAttribute('data-confirm'))) {
    e.preventDefault();
  }
});

// When a file is picked, pre-fill the title from its name (cosmetic only).
document.addEventListener('change', (e) => {
  const input = e.target.closest('#html-file');
  if (!input || !input.files || !input.files[0]) return;
  const title = document.getElementById('import-title');
  if (title && !title.value) {
    title.value = input.files[0].name.replace(/\.[Hh][Tt][Mm][Ll]?$/, '');
  }
});

// Import form: read the chosen HTML file into the textarea AT SUBMIT TIME, so it
// can never race the click, then submit. If the user pasted HTML instead, that
// value is used as-is. Posting the contents as a form field avoids needing a
// multipart upload parser on the server.
document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[action="/import"]');
  if (!form) return;
  const fileInput = form.querySelector('#html-file');
  const ta = form.querySelector('#html-content');
  if (!fileInput || !ta) return;
  const file = fileInput.files && fileInput.files[0];
  if (!file || ta.value.trim()) return; // nothing to read, or user already pasted
  e.preventDefault();
  const reader = new FileReader();
  reader.onload = () => {
    ta.value = reader.result;
    form.submit();
  };
  reader.onerror = () => {
    window.alert('Could not read that file. Try opening it and pasting the HTML instead.');
  };
  reader.readAsText(file);
});
