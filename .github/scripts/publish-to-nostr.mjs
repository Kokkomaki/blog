// publish-to-nostr.mjs — posts a teaser note (kind:1) to Nostr when a new
// blog post is published. Does NOT publish the full article.
//
// Usage:
//   node publish-to-nostr.mjs content/posts/my-post.md [--dry-run]
//
// Env vars:
//   NOSTR_PRIVATE_KEY  nsec1... or raw 64-char hex
//   SITE_BASE_URL      https://www.kokkomaki.com
//   NOSTR_RELAYS       wss://relay.damus.io,wss://nos.lol,wss://relay.nostr.band
//
// --dry-run: prints the note content and exits — no keys needed, no network.

import { finalizeEvent } from 'nostr-tools';
import { Relay }         from 'nostr-tools/relay';
import { nip19 }         from 'nostr-tools';
import matter            from 'gray-matter';
import TOML              from '@iarna/toml';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

// ── Args ──────────────────────────────────────────────────────────────────────
const filePath = process.argv[2];
const dryRun   = process.argv.includes('--dry-run');

if (!filePath) {
  console.error('Usage: publish-to-nostr.mjs <content/posts/file.md> [--dry-run]');
  process.exit(1);
}

// ── Parse post ────────────────────────────────────────────────────────────────
const src = readFileSync(resolve(filePath), 'utf-8');
// Support both YAML (---) and TOML (+++) front matter
const isToml = src.startsWith('+++');
const { data: fm } = matter(src, isToml ? {
  delimiters: '+++',
  engines:    { toml: { parse: TOML.parse, stringify: TOML.stringify } },
  language:   'toml',
} : {});

const baseUrl = (process.env.SITE_BASE_URL || 'https://www.kokkomaki.com').replace(/\/$/, '');
// Handle both slug.md and slug/index.md style posts
const slug    = filePath
  .replace(/^.*content\/posts\//, '')
  .replace(/\/index\.md$/, '')
  .replace(/\.md$/, '');
const postUrl = `${baseUrl}/posts/${slug}/`;
const title   = fm.title       || slug;
const summary = fm.description || '';
const tags    = (fm.tags || []).map(t => String(t).toLowerCase().replace(/\s+/g, '-'));

// ── Post number — count all posts by date, find this post's position ──────────
function parseFm(filePath) {
  try {
    const src = readFileSync(filePath, 'utf-8');
    const isToml = src.startsWith('+++');
    const { data } = matter(src, isToml ? {
      delimiters: '+++',
      engines: { toml: { parse: TOML.parse, stringify: TOML.stringify } },
      language: 'toml',
    } : {});
    return data;
  } catch { return {}; }
}

const postsDir = resolve('content/posts');
const allPosts = readdirSync(postsDir)
  .map(entry => {
    if (entry === '_index.md') return null;
    const entryPath = join(postsDir, entry);
    const isDir = statSync(entryPath).isDirectory();
    const mdPath = isDir ? join(entryPath, 'index.md') : entryPath;
    if (!mdPath.endsWith('.md')) return null;
    const data = parseFm(mdPath);
    if (data.draft === true) return null;                 // exclude drafts
    if (!data.date) return null;                          // exclude undated
    const date = new Date(data.date);
    if (date > new Date()) return null;                   // exclude future posts
    return { slug: entry.replace(/\.md$/, ''), date };
  })
  .filter(Boolean)
  .sort((a, b) => a.date - b.date);  // ascending: oldest = #1

const postNumber = allPosts.findIndex(p => p.slug === slug) + 1;
const postLabel  = postNumber > 0 ? `Post #${postNumber}` : 'New post';

// ── Build teaser text ─────────────────────────────────────────────────────────
//
// Format:
//
//   New post: {title}
//
//   {description — one or two sentences from front matter}
//
//   {url}
//
//   #tag1 #tag2
//
const hashtags   = tags.length ? '\n\n' + tags.map(t => `#${t}`).join(' ') : '';
const teaserText = [
  `${postLabel}: ${title}`,
  summary,
  postUrl,
].filter(Boolean).join('\n\n') + hashtags;

// ── Dry run — preview without keys or network ─────────────────────────────────
if (dryRun) {
  console.log('─────────────────────────────────────────');
  console.log('DRY RUN — would post this note to Nostr:');
  console.log('─────────────────────────────────────────');
  console.log(teaserText);
  console.log('─────────────────────────────────────────');
  process.exit(0);
}

// ── Key & relay setup (only needed for real publish) ──────────────────────────
const rawKey = process.env.NOSTR_PRIVATE_KEY?.trim();
if (!rawKey) { console.error('NOSTR_PRIVATE_KEY env var not set'); process.exit(1); }

const relayUrls = (process.env.NOSTR_RELAYS || '').split(',').map(r => r.trim()).filter(Boolean);
if (!relayUrls.length) { console.error('NOSTR_RELAYS not set'); process.exit(1); }

let privkeyBytes;
if (rawKey.startsWith('nsec')) {
  privkeyBytes = nip19.decode(rawKey).data;
} else {
  privkeyBytes = Uint8Array.from(rawKey.match(/.{2}/g).map(b => parseInt(b, 16)));
}

const pubAt = Math.floor(new Date(fm.date || Date.now()).getTime() / 1000);

const nostrTags = [
  ['r', postUrl],
  ...tags.map(t => ['t', t]),
];

const event = finalizeEvent({
  kind:       1,
  created_at: pubAt,
  tags:       nostrTags,
  content:    teaserText,
}, privkeyBytes);

// ── Publish ───────────────────────────────────────────────────────────────────
console.log(`Publishing teaser for "${title}"`);
console.log(teaserText);
console.log('');

async function publishOne(relayUrl) {
  try {
    const relay = await Relay.connect(relayUrl);
    await relay.publish(event);
    relay.close();
    console.log(`  ✓ ${relayUrl}`);
  } catch (err) {
    console.warn(`  ✗ ${relayUrl}: ${err.message}`);
  }
}

await Promise.allSettled(relayUrls.map(publishOne));
console.log('Done.');
