import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/* Same "leading zero bits of a hex id" check as guestbook.jsx's
   leadingZeroBits -- duplicated rather than imported because a Web Worker
   is its own bundle entry point (no shared module graph with the main
   thread at runtime), and this is a handful of lines, not worth a shared
   chunk. Keep in sync if the NIP-13 logic ever changes. */
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

const utf8 = new TextEncoder();

/* Worker k of n mines a disjoint slice of the nonce space: starts at
   `start` (its worker index) and steps by `stride` (the worker count), so
   the union of every worker's nonces is exactly 0..N with no nonce tried
   twice and none skipped -- see docs/plan-guestbook-pow-speed-2026-09-22.md
   Part 4.2. Hashes prefix + utf8(nonce) + suffix directly, the same
   splice-the-serialized-event trick minePow uses on the main thread (see
   its own comment in guestbook.jsx for why: getEventHash() re-validates
   the whole event on every call and is far too slow in a tight loop). This
   worker only *finds* a winning nonce -- it never constructs or verifies
   the final signed-shape event itself; the main thread rebuilds the final
   event with the reported nonce and re-verifies via the real
   getEventHash() before trusting it, so a bug here can only waste time,
   never produce a bad id that gets published. */
self.onmessage = function (e) {
  const { prefix, suffix, difficulty, start, stride } = e.data;
  let nonce = start;
  let attempts = 0;
  let sinceReport = 0;

  for (;;) {
    const nonceBytes = utf8.encode(String(nonce));
    const full = new Uint8Array(prefix.length + nonceBytes.length + suffix.length);
    full.set(prefix, 0);
    full.set(nonceBytes, prefix.length);
    full.set(suffix, prefix.length + nonceBytes.length);
    const id = bytesToHex(sha256(full));

    if (leadingZeroBits(id) >= difficulty) {
      self.postMessage({ found: true, nonce, attempts });
      return;
    }

    nonce += stride;
    attempts++;
    sinceReport++;
    if (sinceReport >= 20000) {
      self.postMessage({ progress: attempts });
      sinceReport = 0;
    }
  }
};
