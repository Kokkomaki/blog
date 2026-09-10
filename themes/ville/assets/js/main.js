document.addEventListener('DOMContentLoaded', function() {
  var btn = document.getElementById('theme-toggle');
  if (!btn) return;
  // Same icon-only button on every screen size now -- nothing renders the
  // "Light"/"Dark" text, so it just drives aria-label instead of a visible
  // label span.

  function isDarkMode() {
    var theme = document.documentElement.dataset.theme;
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function updateLabel() {
    btn.setAttribute('aria-label', isDarkMode() ? 'Switch to light theme' : 'Switch to dark theme');
  }
  updateLabel();

  btn.addEventListener('click', function() {
    var newTheme = isDarkMode() ? 'light' : 'dark';
    document.documentElement.dataset.theme = newTheme;
    localStorage.setItem('theme', newTheme);
    updateLabel();
  });
});
