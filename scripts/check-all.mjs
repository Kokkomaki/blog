#!/usr/bin/env node
// The blog gate. Run it after every integration and before any push: `npm run check:all`.
// Builds the site like CI does, then checks the built pages. Exit 0 only if everything passes.
// Flags: --keep  keep the build folder and print its path.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const keep = process.argv.includes('--keep');
const skipMobile = process.argv.includes('--skip-mobile');
const updateUrls = process.argv.includes('--update-urls');
// GitHub Pages serves the site on the apex domain and redirects www to it, and CI builds with that
// base URL. Build the gate the same way, or its checks describe a site that does not exist.
const SITE = 'https://kokkomaki.com';
const failures = [];
const notes = [];
const fail = (msg) => failures.push(msg);

function sh(cmd, args) {
  return spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const lines = (file) => fs.readFileSync(file, 'utf8').split('\n').length - (fs.readFileSync(file, 'utf8').endsWith('\n') ? 1 : 0);

// 3. Production-style build, zero ERROR or WARN.
function build(out) {
  const r = sh('hugo', ['--gc', '--minify', '--baseURL', `${SITE}/`, '-d', out]);
  const text = `${r.stdout}\n${r.stderr}`;
  if (r.status !== 0) fail(`hugo build failed:\n${text.trim().split('\n').slice(-12).join('\n')}`);
  for (const l of text.split('\n')) if (/^(ERROR|WARN)\b/.test(l.trim())) fail(`hugo said: ${l.trim()}`);
}

// 4. Built pages: title, share image, existing image file, internal links.
function attr(html, re) { const m = html.match(re); return m ? m[1] : null; }
// Parse the opening tags of one kind (`meta` or `link`) into attribute maps. Minified HTML drops
// attribute quotes, so values may be bare, single-quoted or double-quoted.
function tagsOf(html, name) {
  const head = html.split(/<\/head>/i)[0];
  return [...head.matchAll(new RegExp(`<${name}\\s([^>]*)>`, 'gi'))].map((m) => {
    const attrs = {};
    for (const a of m[1].matchAll(/([^\s=\/]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
    return attrs;
  });
}
// Every page: exactly one canonical equal to og:url. Every page except the home page and Hugo's
// redirect stubs: exactly one meta description equal to og:description.
function checkMeta(page, html) {
  const metas = tagsOf(html, 'meta');
  const ogUrl = metas.filter((t) => t.property === 'og:url').map((t) => t.content);
  const ogDesc = metas.filter((t) => t.property === 'og:description').map((t) => t.content);
  const canon = tagsOf(html, 'link').filter((t) => (t.rel || '').toLowerCase() === 'canonical').map((t) => t.href);
  if (canon.length !== 1) fail(`${page}: ${canon.length} canonical links, expected 1`);
  else if (ogUrl.length !== 1 || canon[0] !== ogUrl[0]) fail(`${page}: canonical ${canon[0]} does not equal og:url ${ogUrl[0]}`);
  const isStub = metas.some((t) => (t['http-equiv'] || '').toLowerCase() === 'refresh');
  if (isStub || page === '/index.html') return;
  const desc = metas.filter((t) => t.name === 'description').map((t) => t.content);
  if (desc.length > 1 || ogDesc.length > 1) fail(`${page}: ${desc.length} meta descriptions and ${ogDesc.length} og:description, expected at most 1 each`);
  else if (desc.length !== ogDesc.length || desc[0] !== ogDesc[0]) fail(`${page}: meta description and og:description must both be present and equal, or both absent`);
  else if (!desc.length) {
    if (/^\/(?:[a-z]{2}\/)?posts\/[^/]+\/index\.html$/.test(page)) fail(`${page}: a post page must have a description`);
    else noDescription.push(page);
  }
  // Quality: a description is read by people in link previews.
  if (desc.length === 1 && desc[0]) {
    if (/&amp;(?:#\d+|[a-z]+);/i.test(desc[0])) fail(`${page}: description shows a raw HTML entity (double-escaped): ${desc[0].slice(0, 60)}`);
    if (/[\w.%+-]+@[\w.-]+\.[a-z]{2,}/i.test(desc[0])) fail(`${page}: description contains an email address`);
  }
}
const noDescription = [];
function checkPages(out) {
  const pages = walk(out).filter((f) => f.endsWith('.html') && !f.includes(`${path.sep}pagefind${path.sep}`));
  const exists = (p) => {
    const rel = decodeURIComponent(p.replace(/[?#].*$/, '')).replace(/^\//, '');
    const f = path.join(out, rel);
    return fs.existsSync(f) && (fs.statSync(f).isFile() || fs.existsSync(path.join(f, 'index.html')));
  };
  for (const file of pages) {
    const page = '/' + path.relative(out, file).split(path.sep).join('/');
    const html = fs.readFileSync(file, 'utf8');
    if (!/<title>[^<]+<\/title>/.test(html)) fail(`${page}: no <title>`);
    checkMeta(page, html);
    const og = attr(html, /property="?og:image"?\s+content="?([^"\s>]+)/);
    const tw = attr(html, /name="?twitter:image"?\s+content="?([^"\s>]+)/);
    if (!og) fail(`${page}: no og:image`);
    if (!tw) fail(`${page}: no twitter:image`);
    if (og && !og.startsWith('https://')) fail(`${page}: og:image is not absolute: ${og}`);
    if (og && og.startsWith(SITE) && !exists(og.slice(SITE.length))) fail(`${page}: og:image file missing: ${og}`);
    for (const m of html.matchAll(/(?:href|src)="?(\/[^"\s>#?]*)/g)) {
      const link = m[1];
      if (link.startsWith('//') || link.startsWith('/pagefind/')) continue;
      if (!exists(link)) fail(`${page}: broken internal link ${link}`);
    }
  }
  notes.push(`pages checked: ${pages.length}`);
  notes.push(`pages without a description (not a failure): ${noDescription.length}${noDescription.length ? ' - ' + noDescription.join(', ') : ''}`);
}

// 5. Drafts and future-dated posts must not be in the build.
function checkDrafts(out) {
  const contentDir = path.join(root, 'content');
  if (!fs.existsSync(contentDir)) return;
  const now = Date.now();
  for (const f of walk(contentDir).filter((p) => /index(\.[a-z]{2})?\.md$/.test(p))) {
    const text = fs.readFileSync(f, 'utf8');
    const toml = text.match(/^\+\+\+\s*\n([\s\S]*?)\n\+\+\+/);
    const yaml = text.match(/^---\s*\n([\s\S]*?)\n---/);
    const fm = toml ? toml[1] : yaml ? yaml[1] : '';
    const draft = /^draft\s*[=:]\s*true/m.test(fm);
    const dateRaw = (fm.match(/^date\s*[=:]\s*["']?([^"'\n]+)/m) || [])[1];
    const future = dateRaw && Date.parse(dateRaw.replace(' ', 'T')) > now;
    if (!draft && !future) continue;
    const rel = path.relative(contentDir, path.dirname(f)).split(path.sep).join('/');
    const lang = (f.match(/index\.([a-z]{2})\.md$/) || [])[1];
    const prefix = lang && lang !== 'en' ? `${lang}/` : '';
    if (fs.existsSync(path.join(out, prefix, rel, 'index.html'))) fail(`draft or future post is in the build: ${rel}${lang ? ` (${lang})` : ''}`);
  }
}

// 6. URL continuity: every address that existed must still exist. New addresses are always fine.
//    Removing or renaming a page on purpose: `npm run check:all -- --update-urls`, then read the diff of
//    scripts/known-urls.txt. Without an alias, the old link is a 404 for everyone who saved it.
function builtUrls(out) {
  const urls = walk(out)
    .filter((f) => f.endsWith('index.html') && !f.includes(`${path.sep}pagefind${path.sep}`))
    .map((f) => '/' + path.relative(out, path.dirname(f)).split(path.sep).join('/') + '/')
    .map((u) => u.replace(/^\/\/$/, '/'));
  for (const f of ['index.xml', 'sitemap.xml']) if (fs.existsSync(path.join(out, f))) urls.push('/' + f);
  return [...new Set(urls)].sort();
}
function checkUrlBaseline(out) {
  const file = path.join(root, 'scripts/known-urls.txt');
  const now = builtUrls(out);
  if (updateUrls) {
    fs.writeFileSync(file, `# Every address the live site has had. check:all fails if one disappears.\n# Update on purpose with: npm run check:all -- --update-urls\n${now.join('\n')}\n`);
    notes.push(`known-urls.txt rewritten with ${now.length} addresses`);
    return;
  }
  if (!fs.existsSync(file)) { fail('scripts/known-urls.txt is missing (create it with --update-urls)'); return; }
  const have = new Set(now);
  const known = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
  for (const u of known) if (!have.has(u)) fail(`address disappeared from the site: ${u}`);
  notes.push(`url continuity: ${known.length} known addresses, ${now.length - known.length >= 0 ? now.length - known.length : 0} new`);
}

// 7. Phone layout: nothing wider than the screen at 390px and 320px (needs a browser).
function checkMobile(out) {
  if (skipMobile) { notes.push('mobile layout check skipped (--skip-mobile)'); return; }
  const r = sh('node', ['scripts/check-mobile.mjs', out]);
  const text = `${r.stdout}${r.stderr}`.trim();
  if (r.status !== 0) fail(`mobile layout:\n${text.split('\n').slice(0, 25).join('\n')}`);
  else notes.push(text.split('\n').pop());
}

// Optional local checks, loaded only when the file exists (it is not part of the repository).
const localChecks = path.join(root, 'scripts/check-private.mjs');
if (fs.existsSync(localChecks)) (await import(pathToFileURL(localChecks).href)).default({ root, fail, notes, sh, lines });
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-gate-'));
try {
  build(out);
  if (fs.existsSync(path.join(out, 'index.html'))) { checkPages(out); checkDrafts(out); checkUrlBaseline(out); checkMobile(out); }
  else fail('build produced no index.html');
} finally {
  if (keep) console.log(`build kept at ${out}`);
  else fs.rmSync(out, { recursive: true, force: true });
}

for (const n of notes) console.log(`note: ${n}`);
if (failures.length) {
  console.error(`\nGATE FAILED, ${failures.length} problem(s):`);
  for (const f of failures.slice(0, 60)) console.error(`  - ${f}`);
  if (failures.length > 60) console.error(`  ... and ${failures.length - 60} more`);
  process.exit(1);
}
console.log('GATE PASSED');
