document.addEventListener('DOMContentLoaded', function() {
  var btn = document.getElementById('theme-toggle');
  if (!btn) return;

  btn.textContent = document.documentElement.dataset.theme === 'dark' ? '●' : '○';

  btn.addEventListener('click', function() {
    var isDark = document.documentElement.dataset.theme === 'dark';
    document.documentElement.dataset.theme = isDark ? 'light' : 'dark';
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
    btn.textContent = isDark ? '○' : '●';
  });
});
