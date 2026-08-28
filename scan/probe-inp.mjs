#!/usr/bin/env node
/**
 * Works out why a scripted tap does not register as an interaction.
 *
 * The scan measures INP from a Lighthouse timespan around one scripted tap. If
 * Chrome never files an event-timing entry for that tap, the audit comes back
 * not-applicable and the sample is thrown away - which is what every mobile
 * sample did. That failure is silent about its cause, so this reproduces the
 * same press outside Lighthouse with a PerformanceObserver watching, which
 * separates "the input never landed" from "Lighthouse did not attribute it".
 *
 *   node scan/probe-inp.mjs
 *
 * Diagnostic only - writes nothing the dashboard reads.
 */

import puppeteer from 'puppeteer';
import { startFlow } from 'lighthouse';

import { TARGETS, OVERLAYS } from './targets.mjs';
import {
  VIEWPORTS,
  configFor,
  navigationFlags,
  timespanFlags,
  TIMESPAN_METRIC,
  TIMESPAN_INSIGHT,
} from './lib/config.mjs';
import { resolveUnique, waitForSettle, press, dismissOverlays } from './lib/interactions.mjs';

/** Set LIGHTHOUSE=1 to run the press inside a real timespan, as the scan does. */
const USE_LIGHTHOUSE = process.env.LIGHTHOUSE === '1';

const OBSERVER = () => {
  window.__events = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      window.__events.push({
        name: entry.name,
        duration: entry.duration,
        interactionId: entry.interactionId,
      });
    }
  }).observe({ type: 'event', buffered: true, durationThreshold: 0 });

  window.__pointer = [];
  for (const type of ['pointerdown', 'pointerup', 'click', 'touchstart', 'touchend']) {
    document.addEventListener(type, () => window.__pointer.push(type), { capture: true });
  }
};

const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

const target = TARGETS.find((t) => t.id === (process.env.TARGET ?? 'landing'));
const interaction = target.interactions.mobile[0];

const browser = await puppeteer.launch({
  headless: process.env.HEADFUL !== '1',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const page = await browser.newPage();
await page.setViewport(VIEWPORTS.mobile);
await page.setUserAgent(MOBILE_UA);

console.log(`[inp] ${target.id} ${target.url}`);
console.log(`[inp] viewport hasTouch=${page.viewport()?.hasTouch}`);

let flow = null;
if (USE_LIGHTHOUSE) {
  flow = await startFlow(page, {
    name: `${target.label} - mobile`,
    config: configFor('mobile'),
    flags: navigationFlags('mobile'),
  });
  await flow.navigate(target.url, { ...navigationFlags('mobile'), name: 'load' });
} else {
  await page.goto(target.url, { waitUntil: 'networkidle2', timeout: 90_000 });
}

console.log(`[inp] after load, hasTouch=${page.viewport()?.hasTouch}`);
await dismissOverlays(page, OVERLAYS, target.id);

const trigger = await resolveUnique(page, interaction.trigger, target.id);

// Watch every event-timing entry, not just the slow ones: durationThreshold 0
// separates "no interaction at all" from "an interaction too fast to exceed the
// default 104ms threshold". Installed after any navigation, or it is wiped.
await page.evaluate(OBSERVER);

if (flow) await flow.startTimespan({ ...timespanFlags('mobile'), name: interaction.name });
await press(page, trigger);
await waitForSettle(page, interaction.settle, target.id);
await new Promise((resolve) => setTimeout(resolve, 1_500));
if (flow) await flow.endTimespan();

const result = await page.evaluate(() => ({
  raw: window.__pointer,
  events: window.__events,
  withInteractionId: window.__events.filter((e) => e.interactionId > 0),
}));

console.log(`[inp] dom events seen: ${JSON.stringify(result.raw)}`);
console.log(`[inp] event-timing entries: ${result.events.length}`);
for (const entry of result.events.slice(0, 12)) {
  console.log(`         ${entry.name} dur=${entry.duration} interactionId=${entry.interactionId}`);
}
console.log(`[inp] entries with a real interactionId: ${result.withInteractionId.length}`);

if (flow) {
  const flowResult = await flow.createFlowResult();
  for (const step of flowResult.steps) {
    if (step.lhr.gatherMode !== 'timespan') continue;
    const audit = step.lhr.audits?.[TIMESPAN_METRIC];
    console.log(
      `[inp] lighthouse "${step.name}": ${TIMESPAN_METRIC} = ` +
        `${audit?.numericValue ?? 'none'} (scoreDisplayMode=${audit?.scoreDisplayMode})`
    );
    if (audit?.explanation) console.log(`[inp]   explanation: ${audit.explanation}`);

    const applicable = Object.entries(step.lhr.audits ?? {})
      .filter(([, a]) => a.scoreDisplayMode !== 'notApplicable')
      .map(([id, a]) => `${id}=${a.numericValue ?? a.scoreDisplayMode}`);
    console.log(`[inp]   audits that did apply: ${applicable.join(', ') || 'none'}`);

    const interaction = step.lhr.audits?.['work-during-interaction'];
    console.log(
      `[inp]   work-during-interaction: ${interaction?.numericValue ?? 'none'} ` +
        `(${interaction?.scoreDisplayMode})`
    );

    const table = step.lhr.audits?.[TIMESPAN_INSIGHT]?.details?.items?.find(
      (item) => item.type === 'table'
    );
    for (const part of table?.items ?? []) {
      console.log(`[inp]   ${part.label}: ${part.duration}ms`);
    }
    const total = (table?.items ?? []).reduce((sum, p) => sum + (p.duration ?? 0), 0);
    console.log(`[inp]   ${TIMESPAN_INSIGHT} total: ${total || 'none'}ms`);
  }
}

await browser.close();
