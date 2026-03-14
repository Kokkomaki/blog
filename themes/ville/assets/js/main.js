document.addEventListener('DOMContentLoaded', function() {
  var btn = document.getElementById('theme-toggle');
  if (!btn) return;

  function isDarkMode() {
    var theme = document.documentElement.dataset.theme;
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  btn.textContent = isDarkMode() ? '●' : '○';

  btn.addEventListener('click', function() {
    var dark = isDarkMode();
    var newTheme = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = newTheme;
    localStorage.setItem('theme', newTheme);
    btn.textContent = dark ? '○' : '●';
  });
});
