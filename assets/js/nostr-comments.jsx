import { createElement, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { NostrComments } from "nostr-comments";

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

  return createElement(NostrComments, { url, theme, locale: "en", pow: 18 });
}

const el = document.getElementById("nostr-comments");
if (el) {
  createRoot(el).render(createElement(CommentsWrapper, { url: el.dataset.url }));
}
