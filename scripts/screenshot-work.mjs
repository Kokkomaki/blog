#!/usr/bin/env node
// Screenshots every live_sites entry in data/work.yaml into static/images/work/.
// Run locally with `npm run screenshot-work`, or via CI before the Hugo build
// so the /work/ page grid always reflects the current state of each site.

import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const entries = yaml.load(readFileSync(path.join(root, "data/work.yaml"), "utf8"));
const targets = entries.filter((e) => e.section === "live_sites" && e.url && e.screenshot);

mkdirSync(path.join(root, "static/images/work"), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

for (const t of targets) {
  const dest = path.join(root, "static", t.screenshot);
  console.log(`Screenshotting ${t.name} -> ${t.screenshot}`);
  // "load" rather than "networkidle" — sites with live data (maps, polling
  // dashboards) never go fully idle. A fixed settle delay covers late-loading
  // visuals (map tiles, charts, web fonts) instead.
  await page.goto(t.url, { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(2500);
  // viewport only, not fullPage — matches the card's cropped hero framing
  await page.screenshot({ path: dest });
}

await browser.close();
console.log(`Done: ${targets.length} screenshot(s).`);
