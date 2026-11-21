#!/usr/bin/env node
// Mobile layout guard. Usage: node scripts/check-mobile.mjs <built site dir> [--widths 390,320]
// Serves the built site, opens every page in a narrow window, and fails when anything is wider than
// the screen. One unbreakable URL, a fixed-width iframe or a wide table is enough to make iOS Safari
// shrink the whole page (found 2026-11-19 on the Samsung post). Third-party requests are blocked, so
// the check never loads analytics or embeds. Without a browser it is skipped locally and FAILS in CI.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  if (process.env.CI) { console.error('check-mobile: playwright is not installed in CI'); process.exit(1); }
  console.log('check-mobile: skipped, playwright is not installed (run npm install)');
  process.exit(0);
}

const out = process.argv[2];
if (!out || !fs.existsSync(out)) { console.error('usage: node scripts/check-mobile.mjs <built site dir>'); process.exit(2); }
const wi = process.argv.indexOf('--widths');
const widths = (wi > -1 ? process.argv[wi + 1] : '390,320').split(',').map(Number);

const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.xml': 'text/xml', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  let f = path.join(out, p);
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

function walk(d, o = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p, o) : o.push(p); } return o; }
const pages = walk(out)
  .filter((f) => f.endsWith('index.html') && !f.includes(`${path.sep}pagefind${path.sep}`))
  .filter((f) => !/http-equiv="?refresh/.test(fs.readFileSync(f, 'utf8')))
  .map((f) => '/' + path.relative(out, path.dirname(f)).split(path.sep).join('/') + '/')
  .map((p) => p.replace(/^\/\/$/, '/'));

let browser;
for (const opts of [{}, { channel: 'chrome' }]) {
  try { browser = await chromium.launch(opts); break; } catch { /* try the next one */ }
}
if (!browser) {
  server.close();
  if (process.env.CI) { console.error('check-mobile: no browser available in CI'); process.exit(1); }
  console.log('check-mobile: skipped, no browser (run `npx playwright install chromium`)');
  process.exit(0);
}

// Runs inside the page. Returns what is wider than the screen and not inside a sideways scroller.
const inPage = (W) => {
  const bad = [];
  const scroller = (el) => {
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && p.getBoundingClientRect().right <= W + 1) return true;
    }
    return false;
  };
  for (const el of document.body.querySelectorAll('*')) {
    const b = el.getBoundingClientRect();
    if (b.width > 0 && b.right > W + 1 && !scroller(el)) {
      const text = (el.tagName === 'A' ? el.getAttribute('href') || '' : (el.textContent || '').trim().replace(/\s+/g, ' ')).slice(0, 60);
      bad.push({ right: Math.round(b.right), tag: el.tagName.toLowerCase(), cls: typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] || '' : '', text });
    }
  }
  bad.sort((a, c) => c.right - a.right);
  return { sw: document.documentElement.scrollWidth, bad: bad.slice(0, 3), n: bad.length };
};

const failures = [];
for (const width of widths) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 } });
  await ctx.route((u) => !['127.0.0.1', 'localhost'].includes(u.hostname), (r) => r.abort());
  const queue = [...pages];
  await Promise.all(Array.from({ length: 4 }, async () => {
    const page = await ctx.newPage();
    for (let url = queue.shift(); url; url = queue.shift()) {
      try { await page.goto(base + url, { waitUntil: 'load', timeout: 20000 }); } catch { /* blocked third-party requests are expected */ }
      await page.evaluate(() => document.fonts.ready).catch(() => {});
      await page.waitForTimeout(100);
      const r = await page.evaluate(inPage, width);
      if (r.sw > width + 1 || r.n) {
        failures.push(`${width}px ${url}: page is ${r.sw}px wide` + r.bad.map((b) => `; ${b.tag}${b.cls ? '.' + b.cls : ''} reaches ${b.right}px "${b.text}"`).join(''));
      }
    }
    await page.close();
  }));
  await ctx.close();
}
// Tables: no ordinary word may be split across lines inside a cell. `overflow-wrap: anywhere` on cells
// once shrank columns to a few pixels and cut words like "Status" in half (found 2026-11-21 in the
// Bitcoin activism post, caused by the phone fix above). Only pages that have a table are checked, at
// desktop and phone widths. A URL may break where it must, so text nodes holding one are skipped.
const tableWidths = [1280, 768, ...widths];
const tablePages = pages.filter((u) => {
  const f = path.join(out, u, 'index.html');
  return fs.existsSync(f) && /<table[\s>]/.test(fs.readFileSync(f, 'utf8'));
});
const inPageTables = () => {
  const sample = new Set();
  let n = 0;
  for (const cell of document.querySelectorAll('main td, main th')) {
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    for (let node; (node = walker.nextNode()); ) {
      const text = node.nodeValue;
      if (/:\/\/|www\./.test(text)) continue;
      for (const m of text.matchAll(/[\p{L}\p{N}]{4,}/gu)) {
        const r = document.createRange();
        r.setStart(node, m.index);
        r.setEnd(node, m.index + m[0].length);
        if (r.getClientRects().length > 1) { n++; if (sample.size < 4) sample.add(m[0]); }
      }
    }
  }
  return { n, sample: [...sample] };
};
for (const width of tableWidths) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 } });
  await ctx.route((u) => !['127.0.0.1', 'localhost'].includes(u.hostname), (r) => r.abort());
  const queue = [...tablePages];
  await Promise.all(Array.from({ length: 4 }, async () => {
    const page = await ctx.newPage();
    for (let url = queue.shift(); url; url = queue.shift()) {
      try { await page.goto(base + url, { waitUntil: 'load', timeout: 20000 }); } catch { /* blocked third-party requests are expected */ }
      await page.evaluate(() => document.fonts.ready).catch(() => {});
      await page.waitForTimeout(900); // the page-load text dissolve (header.html, ~540ms) rewrites text nodes
      const r = await page.evaluate(inPageTables);
      if (r.n) failures.push(`${width}px ${url}: ${r.n} word(s) split across lines in table cells, e.g. ${r.sample.map((w) => `"${w}"`).join(', ')}`);
    }
    await page.close();
  }));
  await ctx.close();
}

await browser.close();
server.close();

failures.sort();
if (failures.length) {
  console.error(`check-mobile: ${failures.length} problem(s): a page wider than the screen, or a word split inside a table (${pages.length} pages at ${widths.join(', ')}px; ${tablePages.length} with tables also at 1280 and 768px):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-mobile: ${pages.length} pages at ${widths.join(' and ')}px, nothing wider than the screen; ${tablePages.length} page(s) with tables keep every word whole at ${tableWidths.join(', ')}px`);
