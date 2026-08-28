#!/usr/bin/env node
/**
 * Selector and context probe.
 *
 * Loads each target with mobile emulation and exercises every interaction
 * through the same resolveUnique / waitForSettle code the real scan uses, so a
 * pass here means the scan will resolve too. Also prints the slowest XHRs and
 * which one the target's search-API pattern picked, since a pattern that drifts
 * onto the wrong request degrades silently.
 *
 * Diagnostic only: no Lighthouse, no data written. Run after any front-end
 * release touching the filter chips, the bottom sheets, or the PDP room list.
 *
 *   node scan/verify.mjs
 *   HEADFUL=1 ONLY_TARGETS=srp node scan/verify.mjs
 */

import puppeteer from 'puppeteer';

import {
  TARGETS,
  CARD_SELECTORS,
  PAGE_MODULES_PATTERN,
  OVERLAYS,
  SHEET_CLOSE,
} from './targets.mjs';
import { VIEWPORTS } from './lib/config.mjs';
import {
  resolveUnique,
  waitForSettle,
  countCards,
  press,
  dismissOverlay,
  dismissOverlays,
} from './lib/interactions.mjs';

const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

const only = process.env.ONLY_TARGETS?.split(',').map((s) => s.trim());
const targets = only ? TARGETS.filter((t) => only.includes(t.id)) : TARGETS;

let problems = 0;

const browser = await puppeteer.launch({
  headless: process.env.HEADFUL !== '1',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

for (const target of targets) {
  console.log(`\n=== ${target.id}  ${target.url}`);
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(VIEWPORTS.mobile);
  await page.setUserAgent(MOBILE_UA);

  const xhr = [];
  page.on('requestfinished', (request) => {
    const type = request.resourceType();
    if (type !== 'xhr' && type !== 'fetch') return;
    let ms = null;
    try {
      const timing = request.response()?.timing();
      if (timing && timing.receiveHeadersEnd >= 0) {
        ms = Math.round(timing.receiveHeadersEnd);
      }
    } catch {
      // Cached responses carry no timing.
    }
    xhr.push({ url: request.url(), ms });
  });

  try {
    await page.goto(target.url, { waitUntil: 'networkidle2', timeout: 60_000 });

    report('cards', `${await countCards(page, CARD_SELECTORS)}`, true);
    report(
      'page-modules-full',
      `${xhr.filter((r) => PAGE_MODULES_PATTERN.test(r.url)).length} request(s)`,
      true
    );

    const pattern = target.context.searchApi;
    if (pattern) {
      const matched = xhr.filter((r) => pattern.test(r.url));
      const slowest = [...matched].sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0))[0];
      report(
        'searchApi',
        slowest
          ? `${matched.length} call(s), slowest ${short(slowest.url)} (${slowest.ms}ms)`
          : `no match for ${pattern}`,
        Boolean(slowest)
      );
    }

    console.log('  slowest xhr:');
    for (const r of [...xhr].sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0)).slice(0, 5)) {
      console.log(`    ${String(r.ms).padStart(6)}ms  ${short(r.url)}`);
    }

    const interactions = target.interactions?.mobile ?? [];
    if (interactions.length > 0) {
      const dismissed = await dismissOverlays(page, OVERLAYS, target.id);
      report('overlays', dismissed.length ? dismissed.join(', ') : 'none present', true);
    }

    for (const [index, interaction] of interactions.entries()) {
      try {
        if (index > 0) await dismissOverlay(page, SHEET_CLOSE, target.id);
        const trigger = await resolveUnique(page, interaction.trigger, interaction.name);
        await press(page, trigger);
        await waitForSettle(page, interaction.settle, interaction.name);
        report(interaction.name, 'trigger resolved, pressed, settled', true);
      } catch (error) {
        report(interaction.name, error.message, false);
      }
    }
  } catch (error) {
    report('page', error.message, false);
  } finally {
    await context.close();
  }
}

await browser.close();
console.log(
  `\n${problems === 0 ? 'All checks passed.' : `${problems} problem(s) found.`}`
);
process.exit(problems === 0 ? 0 : 1);

function report(name, detail, ok) {
  if (!ok) problems++;
  console.log(`  [${ok ? 'ok  ' : 'FAIL'}] ${name}: ${detail}`);
}

function short(url) {
  try {
    const { host, pathname } = new URL(url);
    return `${host}${pathname}`;
  } catch {
    return url;
  }
}
