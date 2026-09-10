document.addEventListener('DOMContentLoaded', function() {
  var btn = document.getElementById('theme-toggle');
  if (!btn) return;
  // Mobile shows an SVG icon instead of this text (see custom.css); the
  // label still gets updated so screen readers and the desktop view both
  // reflect real state. Kept as its own span, not btn.textContent, so
  // setting it doesn't wipe out the icon markup sitting next to it.
  var label = btn.querySelector('.theme-toggle-label');

  function isDarkMode() {
    var theme = document.documentElement.dataset.theme;
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  label.textContent = isDarkMode() ? 'Dark' : 'Light';

  btn.addEventListener('click', function() {
    var dark = isDarkMode();
    var newTheme = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = newTheme;
    localStorage.setItem('theme', newTheme);
    label.textContent = dark ? 'Light' : 'Dark';
  });
});
