#!/usr/bin/env node
/**
 * Reads the localised strings the text-based selectors depend on.
 *
 * Two selectors in targets.mjs match on visible text - the SRP filter chip and
 * the app-install dismissal - because neither element carries a testid or an
 * aria-label. Those strings change with locale, so switching the scan from
 * /en-id/ to /id-id/ needs the Indonesian equivalents read off the live page
 * rather than guessed at.
 *
 * Doubles as a Cloudflare check: it reports whether a plain headless Chrome is
 * challenged, which is the same question the weekly scan has to survive.
 *
 *   node scan/probe-locale.mjs
 *   HEADFUL=1 node scan/probe-locale.mjs
 *
 * Diagnostic only - writes nothing the dashboard reads.
 */

import puppeteer from 'puppeteer';

import { TARGETS, OVERLAYS } from './targets.mjs';
import { VIEWPORTS } from './lib/config.mjs';

const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

const browser = await puppeteer.launch({
  headless: process.env.HEADFUL !== '1',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

for (const target of TARGETS) {
  console.log(`\n=== ${target.id}  ${target.url}`);
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(VIEWPORTS.mobile);
  await page.setUserAgent(MOBILE_UA);

  try {
    await page.goto(target.url, { waitUntil: 'networkidle2', timeout: 90_000 });
  } catch (error) {
    console.log(`  navigation failed: ${error.message}`);
    await context.close();
    continue;
  }

  // Give the promos time to inject; they arrive a beat after load.
  await new Promise((resolve) => setTimeout(resolve, 6_000));

  const report = await page.evaluate(
    (overlaySelectors) => {
      const text = document.body?.innerText ?? '';
      const challenged = /just a moment|robot atau manusia|verify you are human/i.test(text);
      if (challenged) return { challenged: true };

      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      return {
        challenged: false,
        title: document.title.slice(0, 70),
        filterChips: [
          ...document.querySelectorAll(
            '[class*="SrpFilterChipsMobile_wrapper__"] > button[class*="Chip_chip__"]'
          ),
        ].map((b) => b.innerText.trim()),
        sortChip:
          document.querySelector('[data-testid="chip-sort-filter"]')?.innerText?.trim() ?? null,
        overlayButtons: overlaySelectors.flatMap((selector) =>
          [...document.querySelectorAll(selector)]
            .filter(visible)
            .map((b) => b.innerText.trim() || b.getAttribute('aria-label'))
        ),
        seeRoom: document.querySelector('[data-testid="button-see-room"]') != null,
        roomList: document.querySelector('[data-testid="room-list-container"]') != null,
        destination: document.querySelector('[data-testid="destination-input"]') != null,
        cards: document.querySelectorAll(
          '[data-testid="full-product-card"], [data-testid="accom-product-card"]'
        ).length,
      };
    },
    OVERLAYS.map((overlay) => `${overlay.container} button`)
  );

  if (report.challenged) {
    console.log('  CHALLENGED by Cloudflare - no page content available');
  } else {
    for (const [key, value] of Object.entries(report)) {
      if (key === 'challenged') continue;
      console.log(`  ${key}: ${JSON.stringify(value)}`);
    }
  }

  await context.close();
}

await browser.close();
