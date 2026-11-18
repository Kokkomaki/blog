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

// Copy button on every code block (Hugo wraps fenced code in .highlight).
// Text-only, no icon, in line with DESIGN.md. Styling: .code-copy in
// assets/css/custom.css.
(function () {
  // Old-school path: select a hidden textarea and run the copy command.
  // Used on plain http, in old browsers, and whenever the Clipboard API
  // refuses (blocked by a permissions policy, or the page isn't focused).
  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject();
    });
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () {
        return legacyCopy(text);
      });
    }
    return legacyCopy(text);
  }

  function addButtons() {
    document.querySelectorAll('.highlight').forEach(function (box) {
      var code = box.querySelector('pre code');
      if (!code || box.querySelector('.code-copy')) return;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'code-copy';
      btn.textContent = 'copy';
      btn.setAttribute('aria-label', 'Copy code to clipboard');

      var timer;
      function show(label, ok) {
        btn.textContent = label;
        btn.classList.toggle('is-copied', ok);
        btn.setAttribute('aria-label', ok ? 'Copied to clipboard' : 'Copy failed');
        clearTimeout(timer);
        timer = setTimeout(function () {
          btn.textContent = 'copy';
          btn.classList.remove('is-copied');
          btn.setAttribute('aria-label', 'Copy code to clipboard');
        }, 1600);
      }

      btn.addEventListener('click', function () {
        copyText(code.textContent.replace(/\n+$/, '')).then(
          function () { show('copied', true); },
          function () { show('failed', false); }
        );
      });

      box.appendChild(btn);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addButtons);
  } else {
    addButtons();
  }
})();
