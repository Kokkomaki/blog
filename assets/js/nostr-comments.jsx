import { createElement, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { NostrComments } from "nostr-comments";
import { nip19 } from "nostr-tools";

/* Tags every comment/reply with this pubkey so any Nostr client logged in
   as @Kokkomaki (same npub as the site's Nostr social link) surfaces new
   comments as a mention notification -- the library's built-in mechanism
   for "someone commented on your site," no separate infra needed. */
const OWNER_PUBKEY = nip19.decode(
  "npub10apyf3uh7tw80hm8ycqqz8m55zfmn0tzk9wylvxg9jv2vk73sr0q6mvrxt"
).data;

function getTheme() {
  const t = document.documentElement.dataset.theme;
  if (t === "dark" || t === "light") return t;
  return "auto";
}

function CommentsWrapper({ url }) {
  const [theme, setTheme] = useState(getTheme);

  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(getTheme()));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => obs.disconnect();
  }, []);

  return createElement(NostrComments, {
    url,
    theme,
    locale: "en",
    /* Must equal write-policy.sh's MIN_POW, and therefore BASE_POW in
       guestbook.jsx -- post comments and guestbook notes are the same kind
       (1111) hitting the same relay, so ONE server-side threshold governs
       both. Raised 18 -> 19 on 2026-09-22 alongside the guestbook; leaving
       this at 18 while the relay moved to 19 would have silently rejected
       every blog comment while the guestbook kept working. */
    pow: 19,
    mention: OWNER_PUBKEY,
    /* Private relay only -- same reasoning as guestbook.jsx's RELAYS: if
       comments also landed on public relays, deleting from your own
       relay wouldn't actually remove them from everywhere they exist. */
    relays: ["wss://relay.kokkomaki.com"],
  });
}

const el = document.getElementById("nostr-comments");
if (el) {
  createRoot(el).render(createElement(CommentsWrapper, { url: el.dataset.url }));
}
