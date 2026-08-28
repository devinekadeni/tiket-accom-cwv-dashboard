#!/usr/bin/env node
/**
 * Finds hotel detail pages that CrUX actually publishes.
 *
 * CrUX only reports a URL once it clears an undisclosed traffic threshold, and
 * one hotel out of thousands rarely does - the PDP the lab scans does not. The
 * API cannot be enumerated and exposes no traffic figures, so the only way to
 * answer "which PDP would work" is to collect real candidate URLs and ask about
 * each one.
 *
 * Candidates come from the site's own `hotel-pdp-*` sitemaps. Those sit behind
 * Cloudflare, and the clearance is bound to the browser that earned it: fetching
 * them from Node with the browser's cookies still returns 403, so the fetch and
 * the decompression both happen inside the page. Only the matching URLs cross
 * back, which also keeps a 50k-entry sitemap out of the CDP channel.
 *
 * A headless run may be challenged outright. If discovery returns nothing, run
 * with HEADFUL=1 and clear the checkbox by hand; the script waits for the
 * challenge to go before it starts.
 *
 * Probing uses queryRecord rather than queryHistoryRecord: one current window
 * separates presence from absence, and the responses stay small. Use
 * scan/crux-coverage.mjs afterwards to see whether a hit has enough populated
 * windows to be worth charting.
 *
 * Temper expectations on the sitemap path: id-id lists roughly 325k hotel pages
 * across 65 sitemaps, in no useful order, and a 40-URL sample off the front
 * returned nothing. Published PDPs are a needle in that haystack. The one found
 * so far came from a hotel ranking on Google, i.e. from a popularity signal.
 * Feeding this script a top-pages export from analytics will beat sampling by
 * a wide margin - pass those URLs as arguments and skip discovery.
 *
 *   CRUX_API_KEY=... node scan/find-crux-pdp.mjs
 *   CRUX_API_KEY=... LOCALE=id-id LIMIT=400 node scan/find-crux-pdp.mjs
 *   CRUX_API_KEY=... node scan/find-crux-pdp.mjs <url> [url...]
 *
 * Diagnostic only - writes nothing the dashboard reads.
 */

import puppeteer from 'puppeteer';

import { ORIGIN } from './targets.mjs';

const ENDPOINT = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';

// Indonesian by default: it carries most of the traffic, and every English PDP
// probed so far has been below the reporting threshold.
const LOCALE = process.env.LOCALE ?? 'id-id';
// Enough of the long tail to be informative without spending an hour on it.
const LIMIT = Number(process.env.LIMIT ?? 250);
// The documented quota is 150 queries/minute; this stays comfortably under.
const BATCH_SIZE = 10;
const BATCH_PAUSE_MS = 5_000;

const apiKey = process.env.CRUX_API_KEY;
if (!apiKey) {
  console.error('[find] CRUX_API_KEY is not set');
  process.exit(1);
}

// Explicit candidates skip discovery entirely, which is handy for re-checking a
// shortlist without going back through Cloudflare.
const explicit = process.argv.slice(2).filter((arg) => arg.startsWith('http'));

let candidates = explicit;
if (explicit.length > 0) {
  console.log(`[find] probing ${explicit.length} url(s) given on the command line`);
} else {
  candidates = await discover();
}

if (candidates.length === 0) {
  console.error('[find] no candidate PDP urls found');
  process.exit(1);
}

console.log(`[find] ${candidates.length} candidate PDP url(s); probing up to ${LIMIT}`);

const probing = candidates.slice(0, LIMIT);
const found = [];

for (let start = 0; start < probing.length; start += BATCH_SIZE) {
  const batch = probing.slice(start, start + BATCH_SIZE);
  const results = await Promise.all(batch.map(hasFieldData));

  results.forEach((has, index) => {
    if (has) {
      found.push(batch[index]);
      console.log(`[find] HIT  ${batch[index]}`);
    }
  });

  const done = Math.min(start + BATCH_SIZE, probing.length);
  console.log(`[find] ${done}/${probing.length} probed, ${found.length} with field data`);
  if (done < probing.length) {
    await new Promise((resolve) => setTimeout(resolve, BATCH_PAUSE_MS));
  }
}

console.log(`\n[find] ${found.length} PDP(s) published by CrUX:`);
for (const url of found) console.log(`  ${url}`);
if (found.length > 0) {
  console.log('\n[find] check coverage before wiring any of these in:');
  console.log(`  node scan/crux-coverage.mjs ${found[0]}`);
}

/** True when CrUX has a phone record for this exact URL. */
async function hasFieldData(url) {
  const response = await fetch(`${ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, formFactor: 'PHONE' }),
  });

  if (response.status === 404) return false;
  if (response.status === 429) {
    console.warn('[find] rate limited - pausing');
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    return hasFieldData(url);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    console.warn(`[find] ${response.status} for ${url}: ${body?.error?.message ?? ''}`);
    return false;
  }
  return true;
}

async function discover() {
  const browser = await puppeteer.launch({
    headless: process.env.HEADFUL !== '1',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForChallenge(page);

    const index = `${ORIGIN}/sitemap/${LOCALE}/index.xml.gz`;
    const sitemaps = (await locations(page, index)).filter((url) =>
      /hotel-pdp-\d+\.xml/i.test(url)
    );
    console.log(`[find] ${sitemaps.length} PDP sitemap(s) in ${LOCALE}`);

    const urls = new Set();
    for (const sitemap of sitemaps) {
      for (const url of await locations(page, sitemap, pdpPattern())) urls.add(url);
      console.log(`[find] ${sitemap.split('/').pop()} -> ${urls.size} PDP url(s) so far`);
      // The sitemaps are far larger than anything worth probing against a
      // 150/minute quota, so stop once there is a big enough pool to sample.
      if (urls.size >= LIMIT * 4) break;
    }

    return [...urls];
  } finally {
    await browser.close();
  }
}

/** `/<locale>/hotel/<country>/<slug>-<numeric id>` */
function pdpPattern() {
  return `^https://[^/]+/${LOCALE}/hotel/[^/]+/[^/]+-\\d{8,}$`;
}

/**
 * Fetches a gzipped sitemap and returns its <loc> values, optionally filtered.
 *
 * All of it runs in the page: the request has to come from the browser that
 * holds the Cloudflare clearance, and filtering there avoids shipping a whole
 * sitemap back across CDP.
 */
async function locations(page, url, filter = null) {
  const result = await page.evaluate(
    async (target, pattern) => {
      const response = await fetch(target, { credentials: 'include' });
      if (!response.ok) return { ok: false, status: response.status };

      const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
      const xml = await new Response(stream).text();

      const all = [...xml.matchAll(/<loc>\s*([^<\s]+)/g)].map((match) => match[1]);
      const regexp = pattern ? new RegExp(pattern) : null;
      return { ok: true, locs: regexp ? all.filter((loc) => regexp.test(loc)) : all };
    },
    url,
    filter
  );

  if (!result.ok) {
    console.warn(`[find] ${result.status} fetching ${url}`);
    return [];
  }
  return result.locs;
}

/** Cloudflare serves an interlude before the real page; this waits it out. */
async function waitForChallenge(page) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const challenged = await page.evaluate(() =>
      /just a moment|robot atau manusia/i.test(document.body?.innerText ?? '')
    );
    if (!challenged) return;
    if (attempt === 0) {
      console.log('[find] waiting out the bot challenge (HEADFUL=1 lets you clear it by hand)');
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  console.warn('[find] still challenged - discovery will probably come back empty');
}
