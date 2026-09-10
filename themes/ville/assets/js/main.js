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

  var dot = btn.querySelector('.theme-toggle-dot');

  btn.addEventListener('click', function() {
    var newTheme = isDarkMode() ? 'light' : 'dark';
    document.documentElement.dataset.theme = newTheme;
    localStorage.setItem('theme', newTheme);
    updateLabel();

    // Remove-reflow-readd so the animation restarts even on rapid repeat
    // clicks, instead of the class already being present and doing nothing.
    dot.classList.remove('is-clicked');
    void dot.offsetWidth;
    dot.classList.add('is-clicked');
    // animationend is the normal cleanup path; the timeout is just a
    // backstop (matches the CSS's 0.28s duration plus a small margin) in
    // case that event doesn't fire for some reason -- next click's
    // remove-reflow-readd doesn't depend on either path having run.
    setTimeout(function () { dot.classList.remove('is-clicked'); }, 350);
  });

  dot.addEventListener('animationend', function() {
    dot.classList.remove('is-clicked');
  });
});
