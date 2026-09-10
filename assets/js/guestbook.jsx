import { createElement as h, useState, useEffect, useRef, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { useSigner, buildWebComment, publishEvent, fetchComments } from "nostr-comments";
import { getEventHash } from "nostr-tools/pure";
import { nip19 } from "nostr-tools";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { motion, useMotionValue, useSpring, useTransform, useMotionTemplate } from "framer-motion";

/* Guestbook writes go to relay.kokkomaki.com only (not the public defaults
   post comments use) so that anything deleted here is actually gone
   everywhere it exists, not just from one of several copies. */
const RELAYS = ["wss://relay.kokkomaki.com"];

/* PALETTE is the canonical color identity -- what actually gets written
   into the "bg" tag and checked against write-policy.sh's BG_ALLOWLIST.
   That never changes with theme. DARK_PALETTE is a purely *display* layer:
   same hue, same index, re-tuned so a light pastel that reads fine on the
   site's cream background becomes a darker but still vibrant pastel that
   reads on its dark background instead of washing out. Both were
   generated to clear WCAG AA (4.5:1) against the card ink color (#2B2620)
   with real margin (~5.2-6.5:1, verified numerically, not eyeballed) --
   see docs/research-guestbook.md for the derivation if this ever needs
   regenerating.  displayColor() is what every render path uses; PALETTE
   itself is only for the canonical tag value and the write-policy match. */
const PALETTE = [
  "#F6D8C8", "#F7E6A0", "#D9EAC2", "#C7E8E0", "#C6DDEF",
  "#D6D0EF", "#EBC9E0", "#F2C6C6", "#E4DCC8", "#CFE0D8",
];
const DARK_PALETTE = [
  "#F29360", "#CCA811", "#81BC31", "#3FBFA0", "#72B1E3",
  "#AFA2E7", "#E092C7", "#F09191", "#C7A858", "#42C085",
];
const DEFAULT_BG = PALETTE[1]; // yellow, not the tan/beige this used to default to
function displayColor(hex, isDark) {
  if (!isDark) return hex;
  const i = PALETTE.findIndex((c) => c.toLowerCase() === (hex || "").toLowerCase());
  return i === -1 ? hex : DARK_PALETTE[i];
}
const PIN_COLORS = ["#8b2e2e", "#2e5a8b", "#3a7a4a", "#7a5a2e", "#5a3a7a"];
/* Nine deliberately differing fonts for the writer's own name/message --
   not the note's own chrome (labels, date), which stays in the corkboard's
   own Special Elite regardless. All system/web-safe families, no new font
   files to source or self-host: every OS ships enough of these that the
   generic fallback (the second name in each `css` string) still lands in
   the right neighborhood even when the specific face isn't installed.
   ("Script" was Brush Script MT -- pretty but genuinely hard to read at
   this size; Segoe Script/Bradley Hand is still an elegant, differing
   cursive but stays legible. Copperplate dropped by request.) */
const FONTS = [
  { id: "typewriter", label: "Typewriter", css: '"Special Elite", ui-monospace, monospace' },
  { id: "comic", label: "Comic Sans", css: '"Comic Sans MS", "Comic Sans", cursive' },
  { id: "impact", label: "Impact", css: 'Impact, "Arial Narrow Bold", sans-serif' },
  { id: "georgia", label: "Georgia", css: "Georgia, serif" },
  { id: "times", label: "Times", css: '"Times New Roman", Times, serif' },
  { id: "script", label: "Script", css: '"Segoe Script", "Bradley Hand", cursive' },
  { id: "courier", label: "Courier", css: '"Courier New", Courier, monospace' },
  { id: "papyrus", label: "Papyrus", css: "Papyrus, fantasy" },
  { id: "trebuchet", label: "Trebuchet", css: '"Trebuchet MS", sans-serif' },
];
function fontCss(id) {
  return (FONTS.find((f) => f.id === id) || FONTS[0]).css;
}
function safeFont(id) {
  return FONTS.some((f) => f.id === id) ? id : FONTS[0].id;
}
/* Required-field marker and error text: a fixed dark red, tuned (like the
   palette above) to clear 4.5:1 against every card color in both
   palettes, not just the page background -- the original #a03a2c failed
   against several of the brighter dark-palette cards. */
const ACCENT_RED = "#61151B";
const PAGE_SIZE = 10;
const BASE_POW = 18;
const SIG_POW = 22;
const DEV_POW = 1; // dev-only -- gated behind data-dev, which Hugo only ever sets "true" in `hugo server`
/* Matches the actual drawing surface's own aspect ratio (a 230px note,
   minus its 14px side padding, x the 80px-tall .gb-sigpad = 202x80) --
   NOT an arbitrary box. Strokes are normalized into this space
   independent-axis (see pos() below), so if this box's aspect ratio ever
   drifts from the real pad's, whatever was drawn gets stretched when it's
   re-displayed later at a *different* aspect (this was the "squashed
   signature" bug: the old 240x70 box was 3.43:1 against a 2.53:1 pad, and
   the thumb display was a third, different ratio again -- two independent
   stretches stacked). SignatureThumb below renders at this exact aspect
   (width:100%, height:auto against this viewBox) specifically so no
   second mismatch can reappear downstream. */
const SIG_BOX = { w: 202, h: 80 };

function isSafeUrl(u) {
  if (!u) return null;
  const t = u.trim();
  if (!t) return null;
  try {
    const withScheme = /^https?:\/\//i.test(t) ? t : "https://" + t;
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}
function fmtUrlDisplay(u) {
  return u.replace(/^https?:\/\//, "");
}
// Diary-style, not ISO -- this is specific to the guestbook's handwritten-
// note conceit (see DESIGN.md); the rest of the site keeps its own date
// format for authored posts. Local calendar day, not UTC, so "today"
// matches what the viewer actually sees on their own clock.
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function formatHumanDate(d) {
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
// Word (not character) limit -- keeps a note skimmable on a small pinned
// card. Walks to the start of the (limit+1)-th word and cuts there, so
// edits/backspaces inside the allowed words are never disturbed, only
// typing further once the limit is already reached.
const MSG_WORD_LIMIT = 60;
// The real guarantee against a name overlapping/wrapping to a second
// line is CSS truncation on .gb-name (font/width vary, so a character
// count alone can't promise one line) -- this is just a sane upper bound
// on top of that, not the defense itself. 40 was too generous for a
// ~190px card; 30 keeps most real names comfortably clear of ellipsis.
const NAME_MAX = 30;
function countWords(s) {
  const t = (s || "").trim();
  return t ? t.split(/\s+/).length : 0;
}
function limitWords(text, limit) {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (/\S/.test(text[i]) && (i === 0 || /\s/.test(text[i - 1]))) {
      count++;
      if (count > limit) return text.slice(0, i).replace(/\s+$/, "");
    }
  }
  return text;
}
function safeBg(hex) {
  const found = PALETTE.find((c) => c.toLowerCase() === (hex || "").toLowerCase());
  return found || DEFAULT_BG;
}
function safeSigPath(d) {
  if (!d || typeof d !== "string") return null;
  if (d.length > 1500) return null;
  if (!/^[ML0-9.,\-\sQ]+$/.test(d)) return null;
  return d;
}
function escapeForTag(s, max) {
  return (s || "").replace(/\s+/g, " ").trim().slice(0, max);
}

/* ---------- NIP-13: leading zero bits of a hex id ---------- */
function leadingZeroBits(hexId) {
  let bits = 0;
  for (let i = 0; i < hexId.length; i++) {
    const nibble = parseInt(hexId[i], 16);
    if (nibble === 0) { bits += 4; continue; }
    if (nibble === 1) return bits + 3;
    if (nibble <= 3) return bits + 2;
    if (nibble <= 7) return bits + 1;
    return bits;
  }
  return bits;
}

/* Mines a nonce so the event id clears `difficulty` leading zero bits.
   Must happen before signing -- repeatedly invoking a NIP-07 extension's
   signEvent per nonce attempt would spam permission prompts and be far
   too slow; id computation is a pure function of the unsigned fields, so
   it can be done locally and only the final winning event gets signed.

   nostr-tools' own getEventHash() re-validates the entire event (checks
   tag shapes, pubkey format, etc.) on every call via serializeEvent() --
   fine for a one-off hash, but ruinous in a tight loop: a quick benchmark
   here showed ~1-2k hashes/sec through it against ~270k/sec raw SHA-256
   the same browser is otherwise capable of. So the serialized string is
   built once with a unique marker in place of the nonce, split into a
   prefix/suffix around that marker, and each attempt only re-hashes
   prefix+nonce+suffix directly -- no re-validation, no re-stringifying
   the unchanged parts (pubkey/tags/content) every time. */
// Unicode Private Use Area code points (U+E000, U+E001) as the splice
// marker, not a plain word -- this audience (Bitcoin/Nostr readers) is
// exactly the crowd likely to type the literal word "nonce" in a message,
// which a plain-text marker would collide with.
const NONCE_MARKER = String.fromCodePoint(0xe000, 0xe001);
const utf8 = new TextEncoder();

async function minePowSlow(unsigned, difficulty, onProgress) {
  let nonce = 0;
  const tags = unsigned.tags.filter((t) => t[0] !== "nonce");
  tags.push(["nonce", "0", String(difficulty)]);
  const nonceIdx = tags.length - 1;
  let attempts = 0;
  for (;;) {
    tags[nonceIdx] = ["nonce", String(nonce), String(difficulty)];
    const candidate = { ...unsigned, tags };
    const id = getEventHash(candidate);
    if (leadingZeroBits(id) >= difficulty) return candidate;
    nonce++;
    attempts++;
    if (attempts % 400 === 0) {
      onProgress && onProgress(attempts);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
}

async function minePow(unsigned, difficulty, onProgress) {
  const baseTags = unsigned.tags.filter((t) => t[0] !== "nonce");
  const tagsWithMarker = [...baseTags, ["nonce", NONCE_MARKER, String(difficulty)]];
  const serialized = JSON.stringify([0, unsigned.pubkey, unsigned.created_at, unsigned.kind, tagsWithMarker, unsigned.content]);
  const markerIdx = serialized.indexOf(NONCE_MARKER);
  if (markerIdx === -1) return minePowSlow(unsigned, difficulty, onProgress);

  const prefixBytes = utf8.encode(serialized.slice(0, markerIdx));
  const suffixBytes = utf8.encode(serialized.slice(markerIdx + NONCE_MARKER.length));

  let nonce = 0;
  let attempts = 0;
  for (;;) {
    const nonceBytes = utf8.encode(String(nonce));
    const full = new Uint8Array(prefixBytes.length + nonceBytes.length + suffixBytes.length);
    full.set(prefixBytes, 0);
    full.set(nonceBytes, prefixBytes.length);
    full.set(suffixBytes, prefixBytes.length + nonceBytes.length);
    const id = bytesToHex(sha256(full));

    if (leadingZeroBits(id) >= difficulty) {
      const finalTags = [...baseTags, ["nonce", String(nonce), String(difficulty)]];
      const finalEvent = { pubkey: unsigned.pubkey, created_at: unsigned.created_at, kind: unsigned.kind, tags: finalTags, content: unsigned.content };
      if (getEventHash(finalEvent) !== id) return minePowSlow(unsigned, difficulty, onProgress);
      return finalEvent;
    }
    nonce++;
    attempts++;
    if (attempts % 5000 === 0) {
      onProgress && onProgress(attempts);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
}

function strokesToPathData(strokes) {
  return strokes
    .map((pts) => {
      if (!pts.length) return "";
      // A tap (no drag) is a single point, not a 2+ point line -- rendering
      // nothing for it is exactly the "drew eyes and they didn't render"
      // bug. `M x y L x y` is a zero-length subpath: with round linecaps
      // (set by every consumer of this path) SVG renders that as a dot.
      if (pts.length === 1) {
        const p = pts[0];
        return `M ${p.x.toFixed(1)} ${p.y.toFixed(1)} L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      }
      let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
        d += ` Q ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
      }
      const last = pts[pts.length - 1];
      d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
      return d;
    })
    .join(" ");
}

function SignatureThumb({ d, color = "#2b2620" }) {
  if (!d) return null;
  // width:100% + height:auto against this viewBox means the rendered box
  // is *always* SIG_BOX's own aspect ratio, no matter the card's actual
  // width -- the second half of the squash fix (see SIG_BOX comment): a
  // fixed pixel w/h here would just reintroduce a different mismatch.
  return h(
    "svg",
    { viewBox: `0 0 ${SIG_BOX.w} ${SIG_BOX.h}`, style: { display: "block", width: "100%", height: "auto" } },
    h("path", { d, fill: "none", stroke: color, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" })
  );
}

// "Nostrich" mark (github.com/satscoffee/nostr_icons, MIT), recolored to
// ink via CSS `fill: currentColor` on .gb-auth-link svg rather than baked
// into the path, so it always matches whatever text color surrounds it.
const NOSTR_ICON_PATH =
  "m684.72,485.57c.22,12.59-11.93,51.47-38.67,81.3-26.74,29.83-56.02,20.85-58.42,20.16s-3.09-4.46-7.89-3.77-9.6,6.17-18.86,7.2-17.49,1.71-26.06-1.37c-4.46.69-5.14.71-7.2,2.24s-17.83,10.79-21.6,11.47c0,7.2-1.37,44.57,0,55.89s3.77,25.71,7.54,36c3.77,10.29,2.74,10.63,7.54,9.94s13.37.34,15.77,4.11c2.4,3.77,1.37,6.51,5.49,8.23s60.69,17.14,99.43,19.2c26.74.69,42.86,2.74,52.12,19.54,1.37,7.89,7.54,13.03,11.31,14.06s8.23,2.06,12,5.83,1.03,8.23,5.49,11.66c4.46,3.43,14.74,8.57,25.37,13.71,10.63,5.14,15.09,13.37,15.77,16.11s1.71,10.97,1.71,10.97c0,0-8.91,0-10.97-2.06s-2.74-5.83-2.74-5.83c0,0-6.17,1.03-7.54,3.43s.69,2.74-7.89.69-11.66-3.77-18.17-8.57c-6.51-4.8-16.46-17.14-25.03-16.8,4.11,8.23,5.83,8.23,10.63,10.97s8.23,5.83,8.23,5.83l-7.2,4.46s-4.46,2.06-14.74-.69-11.66-4.46-12.69-10.63,0-9.26-2.74-14.4-4.11-15.77-22.29-21.26c-18.17-5.49-66.52-21.26-100.12-24.69s-22.63-2.74-28.11-1.37-15.77,4.46-26.4-1.37c-10.63-5.83-16.8-13.71-17.49-20.23s-1.71-10.97,0-19.2,3.43-19.89,1.71-26.74-14.06-55.89-19.89-64.12c-13.03,1.03-50.74-.69-50.74-.69,0,0-2.4-.69-17.49,5.83s-36.48,13.76-46.77,19.93-14.4,9.7-16.12,13.13c.12,3-1.23,7.72-2.79,9.06s-12.48,2.42-12.48,2.42c0,0-5.85,5.86-8.25,9.97-6.86,9.6-55.2,125.14-66.52,149.83-13.54,32.57-9.77,27.43-37.71,27.43s-8.06.3-8.06.3c0,0-12.34,5.88-16.8,5.88s-18.86-2.4-26.4,0-16.46,9.26-23.31,10.29-4.95-1.34-8.38-3.74c-4-.21-14.27-.12-14.27-.12,0,0,1.74-6.51,7.91-10.88,8.23-5.83,25.37-16.11,34.63-21.26s17.49-7.89,23.31-9.26,18.51-6.17,30.51-9.94,19.54-8.23,29.83-31.54c10.29-23.31,50.4-111.43,51.43-116.23.63-2.96,3.73-6.48,4.8-15.09.66-5.35-2.49-13.04,1.71-22.63,10.97-25.03,21.6-20.23,26.4-20.23s17.14.34,26.4-1.37,15.43-2.74,24.69-7.89,11.31-8.91,11.31-8.91l-19.89-3.43s-18.51.69-25.03-4.46-15.43-15.77-15.43-15.77l-7.54-7.2,1.03,8.57s-5.14-8.91-6.51-10.29-8.57-6.51-11.31-11.31-7.54-25.03-7.54-25.03l-6.17,13.03-1.71-18.86-5.14,7.2-2.74-16.11-4.8,8.23-3.43-14.4-5.83,4.46-2.4-10.29-5.83-3.43s-14.06-9.26-16.46-9.6-4.46,3.43-4.46,3.43l1.37,12-12.2-6.27-7-11.9s2.36,4.01-9.62,7.53c-20.55,0-21.89-2.28-24.93-3.94-1.31-6.56-5.57-10.11-5.57-10.11h-20.57l-.34-6.86-7.89,3.09.69-10.29h-14.06l1.03-11.31h-8.91s3.09-9.26,25.71-22.97,25.03-16.46,46.29-17.14c21.26-.69,32.91,2.74,46.29,8.23s38.74,13.71,43.89,17.49c11.31-9.94,28.46-19.89,34.29-19.89,1.03-2.4,6.19-12.33,17.96-17.6,35.31-15.81,108.13-34,131.53-35.54,31.2-2.06,7.89-1.37,39.09,2.06,31.2,3.43,54.17,7.54,69.6,12.69,12.58,4.19,25.03,9.6,34.29,2.06,4.33-1.81,11.81-1.34,17.83-5.14,30.69-25.09,34.72-32.35,43.63-41.95s20.14-24.91,22.54-45.14,4.46-58.29-10.63-88.12-28.8-45.26-34.63-69.26c-5.83-24-8.23-61.03-6.17-73.03,2.06-12,5.14-22.29,6.86-30.51s9.94-14.74,19.89-16.46c9.94-1.71,17.83,1.37,22.29,4.8,4.46,3.43,11.65,6.28,13.37,10.29.34,1.71-1.37,6.51,8.23,8.23,9.6,1.71,16.05,4.16,16.05,4.16,0,0,15.64,4.29,3.11,7.73-12.69,2.06-20.52-.71-24.29,1.69s-7.21,10.08-9.61,11.1-7.2.34-12,4.11-9.6,6.86-12.69,14.4-5.49,15.77-3.43,26.74,8.57,31.54,14.4,43.2c5.83,11.66,20.23,40.8,24.34,47.66s15.77,29.49,16.8,53.83,1.03,44.23,0,54.86-10.84,51.65-35.53,85.94c-8.16,14.14-23.21,31.9-24.67,35.03-1.45,3.13-3.02,4.88-1.61,7.65,4.62,9.05,12.87,22.13,14.71,29.22,2.29,6.64,6.99,16.13,7.22,28.72Z";

function NostrIcon() {
  return h("svg", { viewBox: "0 0 875 875", "aria-hidden": "true" },
    h("path", { d: NOSTR_ICON_PATH, fill: "currentColor" })
  );
}
function KeyIcon() {
  return h("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" },
    h("circle", { cx: 7, cy: 12, r: 4.2, fill: "none", stroke: "currentColor", strokeWidth: 2.2 }),
    h("rect", { x: 10.8, y: 11, width: 10, height: 2, fill: "currentColor" }),
    h("rect", { x: 17.5, y: 13, width: 2, height: 3.2, fill: "currentColor" }),
    h("rect", { x: 20, y: 13, width: 2, height: 2.2, fill: "currentColor" })
  );
}

/* ---------- card tilt, ported 1:1 from growth.design/case-studies ----------
   Decompiled directly from their production bundle (chunk exporting a
   `Tilt` component built on the same framer-motion primitives used here):
   cursor position within the card is tracked as two motion values (0-1,
   starting centered at .5), each smoothed through its own spring (duration
   0.3s -- real spring physics, not a CSS easing curve, so it can overshoot
   slightly and settles rather than snapping), then mapped to a rotation
   range of -5..5 degrees. rotateY's output range is deliberately reversed
   ([max,-max] instead of [-max,max]) relative to rotateX -- moving the
   cursor right tilts the right edge away, not toward, the viewer, which is
   what actually reads as "looking at a tilted card" rather than the card
   chasing the cursor. A 55deg glare gradient sweeps across based on the
   combined rotation, peaking at maxGlare opacity in the middle of the
   sweep and fading at both ends. On mouse leave both motion values reset
   to center (0.5, 0.5); the spring eases the tilt back to flat rather than
   snapping.

   One value couldn't be recovered from the source: the exact `scale` prop
   passed at growth.design's own call site (the Tilt component's own
   default is 1, i.e. no growth, so grid usage must override it -- the
   component only exposes a *range*, not this site's chosen point in it).
   TILT_SCALE below is a visual match against the reference recording, not
   a value read from source like everything else here. */
const TILT_DURATION = 0.3;
// Both bumped 25% over the growth.design-sourced values: 5deg -> 6.25deg,
// and the 1.05 scale's *growth* (0.05) -> 0.0625, i.e. 1.0625 -- scaling
// the delta rather than the raw multiplier, since scaling 1.05 itself by
// 1.25 (to 1.3125) would be a much bigger jump than "25% more motion" asks for.
const TILT_MAX_DEG = 6.25;
const TILT_PERSPECTIVE = 1000;
const TILT_MAX_GLARE = 0.1;
const TILT_SCALE = 1.0625;

// Cursor position (0..1) -> eased 0..1, flat near the center (0.5) and
// steep near the edges, endpoints unchanged (edgeEase(0)=0, edgeEase(1)=1,
// edgeEase(0.5)=0.5). Recentered to -1..1, cubed (cube of a small number
// is much smaller than the number itself; cube of ±1 is still ±1), then
// mapped back -- that's what concentrates the tilt's visible *change*
// into the last stretch before the card's actual border, instead of
// spreading it evenly from dead-center outward.
function edgeEase(t) {
  const c = (t - 0.5) * 2;
  return (c * c * c) / 2 + 0.5;
}

function TiltCard({ className, style, children, restRotate = 0, interactive = true }) {
  const containerRef = useRef(null);
  const [isHovering, setIsHovering] = useState(false);
  const mvX = useMotionValue(0.5);
  const mvY = useMotionValue(0.5);
  const springX = useSpring(mvX, { duration: TILT_DURATION });
  const springY = useSpring(mvY, { duration: TILT_DURATION });
  const easedX = useTransform(springX, edgeEase);
  const easedY = useTransform(springY, edgeEase);
  const rotateX = useTransform(easedY, [0, 1], [-TILT_MAX_DEG, TILT_MAX_DEG]);
  const rotateY = useTransform(easedX, [0, 1], [TILT_MAX_DEG, -TILT_MAX_DEG]);
  const combined = useTransform([rotateX, rotateY], ([a, b]) => (a ?? 0) + (b ?? 0));
  const glarePos = useTransform(combined, [-TILT_MAX_DEG, TILT_MAX_DEG], [-100, 200]);
  const glareOpacity = useTransform(glarePos, [-100, 50, 200], [0, TILT_MAX_GLARE, 0]);
  const glareGradient = useMotionTemplate`linear-gradient(55deg, transparent, rgba(255, 255, 255, ${glareOpacity}) ${glarePos}%, transparent)`;

  // The compose note (interactive=false): a static rotate only, never
  // mouse-tracked. Two earlier fixes tried to *suppress* the hover-tilt
  // specifically during the message textarea's own resize-drag
  // (mousedown-based, then focus-based) and neither reliably freed the
  // native resize gesture up in practice. Removing the dynamic tilt from
  // the note entirely -- not gating it -- is what actually guarantees
  // nothing interferes: no transform on this element ever changes in
  // response to the mouse, so there is no moving target left for a
  // resize-drag to fight, independent of which exact mechanism was (or
  // wasn't) catching the conflict before. Pinned cards are read-only --
  // no resize handle exists on them -- so they keep the full effect.
  if (!interactive) {
    return h("div", { className: "group relative " + (className || ""), style: { ...style, transform: restRotate ? `rotate(${restRotate}deg)` : undefined } }, children);
  }

  return h(motion.div, {
    ref: containerRef,
    onMouseMove: (e) => {
      const el = containerRef.current;
      if (!el) return;
      const { height, width, left, top } = el.getBoundingClientRect();
      mvX.set((e.clientX - left) / width);
      mvY.set((e.clientY - top) / height);
    },
    onMouseLeave: () => { mvX.set(0.5); mvY.set(0.5); setIsHovering(false); },
    onMouseEnter: () => setIsHovering(true),
    className: "group relative transform-gpu will-change-transform " + (className || ""),
    // rotate is the static resting tilt (the "hand-pinned to a
    // corkboard" look, see cardTiltDeg) that framer-motion composes into
    // the same transform as the hover-driven rotateX/rotateY, not a
    // replacement for them.
    style: { ...style, rotate: restRotate, rotateX, rotateY, transformPerspective: TILT_PERSPECTIVE },
    whileHover: { scaleX: TILT_SCALE, scaleY: TILT_SCALE, scaleZ: TILT_SCALE },
  },
    isHovering && h(motion.div, { className: "gb-glare", style: { backgroundImage: glareGradient } }),
    children
  );
}

/* ---------- live signature pad ----------
   Previously captured the canvas's clientWidth/clientHeight exactly once,
   at mount, and reused that stale pair for every coordinate conversion
   and for the internal pixel-buffer size. If the actual rendered size
   ever differed from that first measurement -- and it reliably did here,
   since the note's `aspect-ratio` sizing settles after the first paint --
   every stroke was drawn and mapped against the wrong dimensions: this is
   what read as "hard to draw" and "crops stuff". Fixed by re-measuring
   getBoundingClientRect() fresh on every event instead of caching it.

   Also now redraws every committed stroke from data on every change
   (redrawAll) instead of only ever appending incremental line segments to
   the canvas, because a ResizeObserver-triggered resize wipes the pixel
   buffer -- without a redraw afterward, already-drawn ink visibly
   vanished from the canvas on any layout shift (e.g. picking a different
   card color re-flowing the note) even though the underlying stroke data
   was untouched -- this is what read as the signature "not consistently
   drawn there". Freehand only -- no shape-tool branching -- by request. */
function useSigPad(canvasRef) {
  const stateRef = useRef({ strokes: [], drawing: false });
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let cw = 0, ch = 0;

    function toCanvas(p) {
      return { x: (p.x / SIG_BOX.w) * cw, y: (p.y / SIG_BOX.h) * ch };
    }
    function redrawAll() {
      ctx.clearRect(0, 0, cw, ch);
      ctx.strokeStyle = "#2b2620"; ctx.fillStyle = "#2b2620";
      ctx.lineWidth = 2.8; ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (const stroke of stateRef.current.strokes) {
        if (!stroke.length) continue;
        if (stroke.length === 1) {
          const p = toCanvas(stroke[0]);
          ctx.beginPath();
          ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        ctx.beginPath();
        const p0 = toCanvas(stroke[0]);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < stroke.length; i++) {
          const p = toCanvas(stroke[i]);
          ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
    }

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return; // not laid out yet
      cw = rect.width; ch = rect.height;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      // setTransform (not scale) so repeated resizes replace rather than
      // compound the DPR scaling factor.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redrawAll();
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    function pos(e) {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * SIG_BOX.w, y: ((e.clientY - r.top) / r.height) * SIG_BOX.h };
    }
    function down(e) {
      const p = pos(e);
      stateRef.current.drawing = true;
      stateRef.current.strokes.push([p]);
      redrawAll();
    }
    function move(e) {
      if (!stateRef.current.drawing) return;
      e.preventDefault();
      const strokes = stateRef.current.strokes;
      strokes[strokes.length - 1].push(pos(e));
      redrawAll();
    }
    function up() {
      stateRef.current.drawing = false;
    }
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    stateRef.current.clear = () => {
      stateRef.current.strokes = [];
      redrawAll();
    };
    return () => {
      ro.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [canvasRef]);
  return stateRef;
}

function parseEntry(ev) {
  const tag = (name) => (ev.tags.find((t) => t[0] === name) || [])[1];
  const rawName = tag("name");
  const rawUrl = tag("url");
  const rawSig = safeSigPath(tag("sig"));
  const bg = safeBg(tag("bg"));
  const font = safeFont(tag("font"));
  const displayName = rawName
    ? escapeForTag(rawName, NAME_MAX)
    : "guest-" + nip19.npubEncode(ev.pubkey).slice(5, 11);
  return {
    id: ev.id,
    name: displayName,
    url: isSafeUrl(rawUrl),
    msg: ev.content,
    bg,
    font,
    sig: rawSig,
    date: formatHumanDate(new Date(ev.created_at * 1000)),
    created_at: ev.created_at,
    pin: PIN_COLORS[Math.abs(hashStr(ev.id)) % PIN_COLORS.length],
    tilt: cardTiltDeg(ev.id),
  };
}
// A plain polynomial hash (h*31+char) barely scatters ids that only
// differ in their last character or two -- exactly the case for the
// dev-only demo board's sequential "demo-0".."demo-13" ids, which all
// landed within ~0.05deg of each other once fed into cardTiltDeg below.
// The finalizer mix (a standard integer-hash avalanche, xorshift +
// multiply) spreads that out properly without changing what hashStr is
// used for elsewhere (pin color selection).
function hashStr(s) {
  let h2 = 0;
  for (let i = 0; i < s.length; i++) h2 = (h2 * 31 + s.charCodeAt(i)) | 0;
  h2 ^= h2 >>> 16;
  h2 = Math.imul(h2, 0x45d9f3b);
  h2 ^= h2 >>> 16;
  return h2;
}
// Deterministic per id, not random-on-every-render -- a card's "hand
// pinned" tilt shouldn't jump around on re-render or page revisit. Range
// -2.5..2.5deg is the resting tilt; hover tilt (TiltCard) composes on
// top of it, not instead of it.
function cardTiltDeg(id) {
  return ((Math.abs(hashStr(id)) % 500) / 100) - 2.5;
}

/* ---------- dev-only demo board ----------
   Only ever rendered when data-dev="true" on the mount element, which the
   Hugo template sets from `hugo.IsDevelopment` -- never true in a
   production build, so none of this ships. Exists so the board, grid,
   pagination, and per-card variety (with/without url, with/without
   signature, all ten colors) can be seen and iterated on without a
   deployed relay. */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function genDemoSig(seed) {
  if (seed === 0) return null;
  const rnd = mulberry32(seed * 97 + 13);
  const strokeCount = 1 + (seed % 3 === 0 ? 1 : 0);
  const strokes = [];
  for (let s = 0; s < strokeCount; s++) {
    const pts = [];
    const baseY = 20 + rnd() * 30 + s * 8;
    const amp = 8 + rnd() * 14;
    const freq = 1.5 + rnd() * 2.5;
    const phase = rnd() * Math.PI * 2;
    const slant = (rnd() - 0.5) * 18;
    const startX = 8 + s * 16;
    const endX = 194 - rnd() * 16;
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const x = startX + (endX - startX) * t;
      const y = baseY + Math.sin(t * Math.PI * freq + phase) * amp * (0.4 + 0.6 * Math.sin(t * Math.PI)) + slant * t;
      pts.push({ x, y: Math.max(4, Math.min(76, y)) });
    }
    strokes.push(pts);
  }
  return strokesToPathData(strokes);
}
const DEMO_SEED = [
  { name: "Anna K.", url: null, msg: "Found your Bitcoin & peace piece from a Nostr repost. Signing in solidarity.", color: 4, sig: 1 },
  { name: "Jukka", url: "jukka.fi", msg: "Read the vipassana post twice. Needed it today.", color: 2, sig: 2 },
  { name: "anonymous", url: null, msg: "hi", color: 8, sig: 0 },
  { name: "Sofia R.", url: "sofia.blog", msg: "The lawn mower manifesto made me laugh out loud on a train.", color: 6, sig: 3 },
  { name: "Marko", url: null, msg: "Fellow ex-soldier here. Thank you for writing what you wrote.", color: 1, sig: 4 },
  { name: "Elina", url: "elina.codes", msg: "Your Umami analytics writeup helped me ship mine this week.", color: 5, sig: 0 },
  { name: "Timo H.", url: null, msg: "Reading from Rovaniemi. Keep going.", color: 9, sig: 5 },
  { name: "Priya", url: "priya.nyc", msg: "Found this through a Bitcoin thread, stayed for the essays.", color: 3, sig: 6 },
  { name: "anonymous", url: null, msg: "signing because everyone else did :)", color: 7, sig: 0 },
  { name: "Oskari", url: null, msg: "The 'why do we cut grass' post rewired something in my head.", color: 0, sig: 7 },
  { name: "Leena V.", url: "leena.fi", msg: "Peace studies alum too — small world. Loved the mediation post.", color: 4, sig: 8 },
  { name: "Kasper", url: null, msg: "guestbooks are back baby", color: 9, sig: 9 },
  { name: "Ines", url: "ines.dev", msg: "The nostr guestbook is such a nice touch. Building one myself now.", color: 2, sig: 10 },
  { name: "anonymous", url: null, msg: "signed (well, keyboarded).", color: 6, sig: 0 },
];
function buildDemoEntries() {
  const now = Math.floor(Date.now() / 1000);
  return DEMO_SEED.map((e, i) => ({
    id: "demo-" + i,
    name: e.name,
    url: e.url,
    msg: e.msg,
    bg: PALETTE[e.color],
    font: FONTS[i % FONTS.length].id,
    sig: genDemoSig(e.sig),
    date: formatHumanDate(new Date((now - i * 86400) * 1000)),
    created_at: now - i * 3600,
    pin: PIN_COLORS[i % PIN_COLORS.length],
    tilt: cardTiltDeg("demo-" + i),
  }));
}

/* Same isDarkMode() logic as themes/ville/assets/js/main.js: an explicit
   data-theme wins, otherwise fall back to the OS preference. Watches both,
   since either can change without a page reload (the toggle, or the user
   switching their OS theme mid-visit). */
function isDarkNow() {
  const t = document.documentElement.dataset.theme;
  if (t === "dark") return true;
  if (t === "light") return false;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}
function useIsDarkMode() {
  const [isDark, setIsDark] = useState(isDarkNow);
  useEffect(() => {
    const recompute = () => setIsDark(isDarkNow());
    const obs = new MutationObserver(recompute);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
    mq && mq.addEventListener("change", recompute);
    return () => {
      obs.disconnect();
      mq && mq.removeEventListener("change", recompute);
    };
  }, []);
  return isDark;
}

function Guestbook({ url, isDev }) {
  const isDark = useIsDarkMode();
  const { signer, isLoggedIn, isNip07Available, loginWithNip07, loginWithTemp, loginWithBunker, getTempSigner, signerInfo, error: signerError } =
    useSigner();
  const [entries, setEntries] = useState([]);
  const [loadState, setLoadState] = useState("loading");
  const [page, setPage] = useState(0);
  const [name, setName] = useState("");
  const [urlField, setUrlField] = useState("");
  const [msg, setMsg] = useState("");
  const [color, setColor] = useState(DEFAULT_BG);
  const [font, setFont] = useState(FONTS[0].id);
  const [bunkerUrl, setBunkerUrl] = useState("");
  const [status, setStatus] = useState(null);
  const [statusIsError, setStatusIsError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [fontOpen, setFontOpen] = useState(false);
  const canvasRef = useRef(null);
  const sigState = useSigPad(canvasRef);
  const toolbarRef = useRef(null);
  const pagerRef = useRef(null);

  // Closes an open color/font dropdown on any click outside the toolbar --
  // without this, picking a color then clicking straight into the message
  // field would leave the color menu sitting open over the note.
  useEffect(() => {
    function onDocClick(e) {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target)) {
        setColorOpen(false);
        setFontOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Fixes the pager jump: page 1 and page 2 hold a different set of notes,
  // and the masonry grid's *total height* depends on exactly which notes
  // are in it -- so changing pages reflows the grid to a taller or
  // shorter height, and everything below it (the pager included) shifts
  // up or down by that difference. scrollY itself never changes, so from
  // the visitor's fixed viewpoint the pager (and the page generally)
  // visibly drifts after every click -- which direction depends on
  // whether the new page happens to be taller or shorter, which is why
  // it looked inconsistent rather than a single predictable direction.
  // Fix: remember the pager's on-screen position right before the page
  // number changes, then once the DOM has actually re-rendered with the
  // new page's notes (this effect, keyed on `page`, only runs after that
  // commit), nudge the scroll position by exactly however far the pager
  // moved -- so it lands back where it visually was, regardless of the
  // new page's height. Skipped on mount (page's initial value isn't a
  // "change" to correct for).
  const pagerAnchorY = useRef(null);
  const isFirstPageEffect = useRef(true);
  useEffect(() => {
    if (isFirstPageEffect.current) { isFirstPageEffect.current = false; return; }
    if (pagerAnchorY.current !== null && pagerRef.current) {
      const newY = pagerRef.current.getBoundingClientRect().top;
      window.scrollBy(0, newY - pagerAnchorY.current);
    }
  }, [page]);
  function goToPage(next) {
    pagerAnchorY.current = pagerRef.current ? pagerRef.current.getBoundingClientRect().top : null;
    setPage(next);
  }

  useEffect(() => {
    let cancelled = false;
    fetchComments({ url, relays: RELAYS, limit: 500 })
      .then((events) => {
        if (cancelled) return;
        const parsed = events.map(parseEntry).sort((a, b) => b.created_at - a.created_at);
        setEntries(isDev ? [...parsed, ...buildDemoEntries()] : parsed);
        setLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        if (isDev) {
          setEntries(buildDemoEntries());
          setLoadState("ready");
        } else {
          setLoadState("error");
        }
      });
    return () => { cancelled = true; };
  }, [url, isDev]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !msg.trim()) {
      setStatusIsError(true);
      setStatus("Name and message are both required.");
      return;
    }
    setStatusIsError(false);
    setSubmitting(true);
    try {
      // No separate "sign in" step for the common case: signing a
      // guestbook entry needs no persistent identity, so the primary
      // button transparently creates a one-off temporary key rather than
      // forcing a decision most visitors have no context for. Anyone who
      // already has a Nostr identity can use it via "Already have a
      // Nostr key?" below -- that flow logs in first, so `signer` is
      // already set by the time this runs.
      let activeSigner = signer;
      if (!activeSigner) {
        setStatus("Creating a one-time key…");
        await loginWithTemp();
        activeSigner = getTempSigner();
      }
      if (!activeSigner) {
        setStatusIsError(true);
        setStatus("Couldn't create a signing key. Try again.");
        setSubmitting(false);
        return;
      }
      const pubkey = await activeSigner.getPublicKey();
      const base = buildWebComment({ url, content: msg.trim().slice(0, 500) });
      const strokes = sigState.current.strokes.filter((s) => s.length > 0);
      const sigD = strokes.length ? strokesToPathData(strokes).slice(0, 1500) : null;
      const customTags = [];
      const cleanName = escapeForTag(name, NAME_MAX);
      if (cleanName) customTags.push(["name", cleanName]);
      const cleanUrl = isSafeUrl(urlField);
      if (cleanUrl) customTags.push(["url", cleanUrl.slice(0, 80)]);
      customTags.push(["bg", color]);
      customTags.push(["font", font]);
      if (sigD) customTags.push(["sig", sigD]);

      const difficulty = isDev ? DEV_POW : (sigD ? SIG_POW : BASE_POW);
      const unsigned = { pubkey, created_at: base.created_at, kind: base.kind, tags: [...base.tags, ...customTags], content: base.content };
      setStatus(`Mining proof-of-work (${difficulty} bits)…`);
      const mined = await minePow(unsigned, difficulty, (n) => setStatus(`Mining proof-of-work (${difficulty} bits)… ${n.toLocaleString()} attempts`));
      setStatus("Signing…");
      const { pubkey: _pk, ...template } = mined;
      const signed = await activeSigner.signEvent(template);

      // Shown as soon as it's signed, not after the relay confirms: the
      // event is already valid and self-contained at this point, and a
      // relay hiccup (or, right now, relay.kokkomaki.com's write-policy
      // not being deployed yet) shouldn't make a visitor's card vanish or
      // look like it failed when it didn't. No terminal "done" status text
      // either way -- the card appearing on the board already says that,
      // and a redundant "Pinned to the board." message was asked to go.
      setEntries((prev) => [parseEntry(signed), ...prev]);
      setPage(0);
      setName(""); setUrlField(""); setMsg(""); setColor(DEFAULT_BG); setFont(FONTS[0].id);
      sigState.current.clear && sigState.current.clear();
      setStatus(null);

      try {
        await publishEvent(RELAYS, signed);
      } catch (publishErr) {
        // Silent to the visitor by request -- the card is already pinned
        // and visible either way, so a relay-reachability detail (often
        // just relay.kokkomaki.com's write-policy not being deployed yet
        // in dev) isn't theirs to worry about. Still logged for us.
        console.warn("Guestbook: publish to relay failed (card still shown locally):", publishErr);
      }
    } catch (err) {
      setStatusIsError(true);
      setStatus("Couldn't sign that entry: " + (err && err.message ? err.message : "unknown error"));
    } finally {
      setSubmitting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const pageEntries = entries.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const currentFont = FONTS.find((f) => f.id === font) || FONTS[0];
  const signedIn = isLoggedIn && signerInfo && signerInfo.type !== "temp";

  return h(Fragment, null,
    /* Rendered here, not as static page content (content/guestbook/index.md
       keeps only the title now) -- the trailing "browser extension or
       bunker" clause needs real signer state/handlers, and keeping the
       whole paragraph in one place means one signer, not two disconnected
       copies. .gb-intro opts back out of .gb-board's forced ink color
       (see that rule's own comment) so this still respects the site's
       normal light/dark text color instead of going invisible in dark
       mode the way plain ink-on-dark would. */
    h("p", { className: "gb-intro" },
      "Welcome to my guestbook! You don't need an account necessarily, but if you'd like, this is powered by ",
      h("a", { href: "https://nostr.org/", target: "_blank", rel: "noopener" }, "Nostr"),
      ". You may create your first Nostr account, for example, at ",
      h("a", { href: "https://jumble.social/", target: "_blank", rel: "noopener" }, "Jumble.Social"),
      ". ",
      signedIn
        ? `Signed in with ${signerInfo.type === "nip07" ? "browser extension" : "bunker"}.`
        : h(Fragment, null,
            "Already have a Nostr key? ",
            h("button", {
              type: "button", className: "gb-inline-auth-link",
              onClick: () => isNip07Available ? loginWithNip07() : window.open("https://getalby.com", "_blank", "noopener"),
            }, h(NostrIcon, null), "Browser extension"),
            " or ",
            h("span", { className: "gb-inline-bunker" },
              h(KeyIcon, null),
              h("input", { type: "text", placeholder: "bunker://…", value: bunkerUrl, maxLength: 200, onChange: (e) => setBunkerUrl(e.target.value) }),
              h("button", { type: "button", className: "gb-auth-go", "aria-label": "Connect", title: "Connect", onClick: () => bunkerUrl && loginWithBunker(bunkerUrl) }, "→")
            ),
            "."
          )
    ),
    h("form", { className: "gb-compose", onSubmit: handleSubmit },
      /* Back to three separate controls (the stamp-block merge read as
         ugly, by explicit feedback) -- a color swatch, a font trigger,
         Pin it, each its own box with a gap between. All three share one
         fixed 36px height set explicitly (not left to each element's own
         padding+line-height, which is what made the earlier version of
         this look subtly unaligned) so they're genuinely symmetrical, and
         square corners throughout (border-radius: 0) except the color
         swatch, which stays a circle -- that's a color-picker convention,
         not "rounded" in the sense that was rejected. */
      h("div", { className: "gb-toolbar", ref: toolbarRef },
        h("div", { className: "gb-tool" },
          h("button", {
            type: "button", className: "gb-tool-trigger gb-color-trigger",
            style: { background: displayColor(color, isDark) },
            "aria-label": "Card color", "aria-expanded": colorOpen,
            onClick: () => { setColorOpen((v) => !v); setFontOpen(false); },
          }),
          colorOpen && h("div", { className: "gb-tool-menu gb-color-menu" },
            PALETTE.map((c) =>
              h("button", {
                key: c, type: "button", className: "gb-swatch", style: { background: displayColor(c, isDark) },
                "aria-pressed": c === color, "aria-label": c,
                onClick: () => { setColor(c); setColorOpen(false); },
              })
            )
          )
        ),
        h("div", { className: "gb-tool" },
          /* The trigger itself is set in the chosen font -- "Comic Sans"
             literally reads in Comic Sans -- so it doubles as a live
             indicator of what's currently selected, not just a label. */
          h("button", {
            type: "button", className: "gb-tool-trigger gb-font-trigger", style: { fontFamily: currentFont.css },
            "aria-label": "Font", "aria-expanded": fontOpen,
            onClick: () => { setFontOpen((v) => !v); setColorOpen(false); },
          }, currentFont.label),
          fontOpen && h("div", { className: "gb-tool-menu gb-font-menu" },
            FONTS.map((f) =>
              h("button", {
                key: f.id, type: "button", className: "gb-font-swatch",
                style: { fontFamily: f.css }, "aria-pressed": f.id === font,
                onClick: () => { setFont(f.id); setFontOpen(false); },
              }, f.label)
            )
          )
        ),
        h("button", {
          type: "submit", className: "gb-tool-trigger gb-toolbar-submit", style: { fontFamily: currentFont.css }, disabled: submitting,
        }, submitting ? "Working…" : "Pin it")
      ),
      status && h("div", { className: statusIsError ? "gb-status gb-error" : "gb-status" }, status),
      signerError && h("div", { className: "gb-status gb-error" }, signerError),
      /* The note: only what actually ends up on the pinned card (name,
         url, message, signature) -- roughly square, same proportions as a
         real card, so composing it previews the result directly instead
         of filling out an unrelated tall form. interactive:false -- no
         hover-tilt here (see TiltCard) so nothing ever fights the message
         textarea's own native resize handle. */
      h(TiltCard, { className: "gb-note", interactive: false, style: { background: displayColor(color, isDark) } },
        h("label", { className: "gb-flabel", htmlFor: "gb-name" }, "Name: ", h("span", { className: "gb-required" }, "*")),
        h("input", { id: "gb-name", type: "text", maxLength: NAME_MAX, value: name, required: true, style: { fontFamily: fontCss(font) }, onChange: (e) => setName(e.target.value) }),
        h("label", { className: "gb-flabel", htmlFor: "gb-url" }, "URL (optional):"),
        h("input", { id: "gb-url", type: "text", maxLength: 80, value: urlField, onChange: (e) => setUrlField(e.target.value) }),
        h("label", { className: "gb-flabel", htmlFor: "gb-msg" }, "Message: ", h("span", { className: "gb-required" }, "*")),
        h("textarea", {
          id: "gb-msg", maxLength: 500, value: msg, required: true, style: { fontFamily: fontCss(font) },
          onChange: (e) => setMsg(limitWords(e.target.value, MSG_WORD_LIMIT)),
        }),
        h("div", { className: "gb-wordcount" }, `${countWords(msg)}/${MSG_WORD_LIMIT} words`),
        h("label", { className: "gb-flabel" }, "Signature"),
        h("canvas", { ref: canvasRef, className: "gb-sigpad" }),
        h("div", { className: "gb-pad-actions" },
          h("button", { type: "button", className: "gb-clear-btn", onClick: () => sigState.current.clear && sigState.current.clear() }, "clear")
        )
      )
    ),
    loadState === "loading" && h("div", { className: "gb-status" }, "Loading the board…"),
    loadState === "error" && h("div", { className: "gb-status gb-error" }, "Couldn't reach the relay right now."),
    loadState === "ready" && entries.length > 0 && h(Fragment, null,
      h("div", { className: "gb-grid" },
        pageEntries.map((en) =>
          h(TiltCard, { key: en.id, className: "gb-card", style: { background: displayColor(en.bg, isDark) }, restRotate: en.tilt },
            h("div", { className: "gb-pin", style: { background: en.pin } }),
            h("div", { className: "gb-pin-date" }, en.date),
            h("div", { className: "gb-name", style: { fontFamily: fontCss(en.font) } }, en.name),
            en.url && h("div", { className: "gb-url" }, fmtUrlDisplay(en.url)),
            h("div", { className: "gb-msg", style: { fontFamily: fontCss(en.font) } }, en.msg),
            en.sig && h("div", { className: "gb-sig" }, h(SignatureThumb, { d: en.sig }))
          )
        )
      ),
      /* Pin dots: bare ink arrow glyphs flanking one dot per page (the
         current one picked out in the same red used for required-field
         marks elsewhere), instead of the boxed/rounded button pair -- see
         the pager-mockups artifact for the other two directions this was
         chosen over. Each dot is also a direct jump to that page, not
         just a page-count indicator. */
      h("div", { className: "gb-pager", ref: pagerRef },
        h("button", { type: "button", className: "gb-pager-arrow", disabled: page === 0, "aria-label": "Previous page", onClick: () => goToPage(page - 1) }, "‹"),
        h("div", { className: "gb-pager-dots" },
          Array.from({ length: totalPages }, (_, i) =>
            h("button", {
              key: i, type: "button", className: "gb-pager-dot" + (i === page ? " active" : ""),
              "aria-label": `Page ${i + 1}`, "aria-current": i === page, onClick: () => goToPage(i),
            })
          )
        ),
        h("button", { type: "button", className: "gb-pager-arrow", disabled: page >= totalPages - 1, "aria-label": "Next page", onClick: () => goToPage(page + 1) }, "›")
      )
    )
  );
}

const el = document.getElementById("guestbook-board");
if (el) {
  createRoot(el).render(h(Guestbook, { url: el.dataset.url, isDev: el.dataset.dev === "true" }));
}
