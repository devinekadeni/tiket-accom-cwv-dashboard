#!/usr/bin/env node
/**
 * Weekly Lighthouse scan.
 *
 * Per target, per form factor, N samples: one navigation (simulated throttling,
 * the low-variance mode) followed by the target's timespan interactions
 * (devtools throttling, the only mode that can measure INP).
 *
 * Writes data/runs/YYYY-Www.json - medians with min/max and run context, a few
 * KB - and reports/ - the full flow HTML reports, which are far too large for
 * git and go to Actions artifacts instead.
 *
 * Env overrides, all optional:
 *   SAMPLES=5            samples per target per form factor
 *   ONLY_TARGETS=srp,pdp restrict to these target ids
 *   ONLY_FORM_FACTORS=mobile
 *   PERIOD=2026-09-01     override the derived run date
 *   HEADFUL=1            watch the browser
 *   NO_REPORTS=1         skip HTML report generation
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer';
import { startFlow } from 'lighthouse';

import {
  TARGETS,
  FORM_FACTORS,
  DEFAULT_SAMPLES,
  CARD_SELECTORS,
  OVERLAYS,
  SHEET_CLOSE,
} from './targets.mjs';
import {
  configFor,
  navigationFlags,
  timespanFlags,
  NAVIGATION_METRICS,
  TIMESPAN_METRIC,
  TIMESPAN_INSIGHT,
  VIEWPORTS,
} from './lib/config.mjs';
import {
  resolveUnique,
  waitForSettle,
  countCards,
  press,
  dismissOverlay,
  dismissOverlays,
} from './lib/interactions.mjs';
import { attachContextCapture } from './lib/context.mjs';
import { assertNotChallenged } from './lib/challenge.mjs';
import { summarize, runDate } from './lib/stats.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SAMPLES = Number(process.env.SAMPLES) || DEFAULT_SAMPLES;
/** Held open after an interaction settles so its event timing can finalise. */
const INTERACTION_DWELL_MS = 1_000;
const PERIOD = process.env.PERIOD || runDate();
const WRITE_REPORTS = process.env.NO_REPORTS !== '1';

const selectedTargets = filterBy(TARGETS, process.env.ONLY_TARGETS, (t) => t.id);
const selectedFormFactors = filterBy(
  FORM_FACTORS,
  process.env.ONLY_FORM_FACTORS,
  (f) => f
);

async function main() {
  const startedAt = Date.now();
  console.log(
    `[scan] run ${PERIOD}, ${selectedTargets.length} targets x ` +
      `${selectedFormFactors.length} form factors x ${SAMPLES} samples`
  );

  const browser = await puppeteer.launch({
    headless: process.env.HEADFUL !== '1',
    args: [
      // GitHub runners are fine without this, but containers are not, and the
      // cost of always passing it is nothing.
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  const run = {
    period: PERIOD,
    runAt: new Date().toISOString(),
    samples: SAMPLES,
    lighthouseVersion: null,
    // Absolute values depend on where the runner sits relative to the SEA
    // origin, so the trend is only comparable while this stays constant.
    runner: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      ci: process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local',
      commit: process.env.GITHUB_SHA ?? null,
    },
    targets: {},
  };

  const failures = [];

  try {
    for (const target of selectedTargets) {
      run.targets[target.id] = {
        label: target.label,
        url: target.url,
        formFactors: {},
      };

      for (const formFactor of selectedFormFactors) {
        const label = `${target.id}/${formFactor}`;
        const collected = [];
        const errors = [];

        for (let sample = 1; sample <= SAMPLES; sample++) {
          const sampleLabel = `${label} #${sample}`;
          const t0 = Date.now();
          try {
            const result = await runSample(browser, target, formFactor, sample);
            collected.push(result);
            run.lighthouseVersion ??= result.lighthouseVersion;
            console.log(
              `[scan] ${sampleLabel} ok in ${Math.round((Date.now() - t0) / 1000)}s ` +
                `(lcp ${fmt(result.metrics.lcp)}ms, cls ${fmt(result.metrics.cls)})`
            );
          } catch (error) {
            errors.push({ sample, message: String(error?.message ?? error) });
            console.error(`[scan] ${sampleLabel} FAILED: ${error?.message ?? error}`);
          }
        }

        if (collected.length === 0) failures.push(label);
        run.targets[target.id].formFactors[formFactor] = aggregate(collected, errors);
      }
    }
  } finally {
    await browser.close();
  }

  const minutes = ((Date.now() - startedAt) / 60_000).toFixed(1);
  const runPath = path.join(REPO_ROOT, 'data', 'runs', `${PERIOD}.json`);

  // A partial run is worth keeping - the dashboard can show the gap - but a
  // run where nothing succeeded is not a data point, and writing it would put
  // an empty entry into the trend for the workflow to dutifully commit.
  const total = selectedTargets.length * selectedFormFactors.length;
  if (failures.length === total) {
    console.error(`[scan] nothing succeeded in ${minutes} min, writing no run file`);
    throw new Error(`no successful samples for: ${failures.join(', ')}`);
  }

  await fs.mkdir(path.dirname(runPath), { recursive: true });
  await fs.writeFile(runPath, `${JSON.stringify(run, null, 2)}\n`);
  console.log(`[scan] wrote ${path.relative(REPO_ROOT, runPath)} in ${minutes} min`);

  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, `period=${PERIOD}\n`);
  }

  if (failures.length > 0) {
    // The partial run has been recorded, but the workflow must still go red.
    throw new Error(`no successful samples for: ${failures.join(', ')}`);
  }
}

async function runSample(browser, target, formFactor, sample) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();

  try {
    await page.setViewport(VIEWPORTS[formFactor]);
    const capture = attachContextCapture(page, {
      searchApiPattern: target.context.searchApi,
    });

    const flow = await startFlow(page, {
      name: `${target.label} - ${formFactor}`,
      config: configFor(formFactor),
      flags: navigationFlags(formFactor),
    });

    await flow.navigate(target.url, {
      ...navigationFlags(formFactor),
      name: 'load',
    });

    // Before anything is read off the page, since a challenge interstitial
    // measures as a fast, clean page rather than as a failure.
    await assertNotChallenged(page, `${target.id}/${formFactor}`);

    const cards = target.context.cards
      ? await countCards(page, CARD_SELECTORS)
      : null;

    const interactions = target.interactions?.[formFactor] ?? [];
    // Only interactions are blocked by the promos, so desktop's
    // navigation-only run skips the wait entirely.
    const overlaysDismissed =
      interactions.length > 0
        ? await dismissOverlays(page, OVERLAYS, `${target.id}/${formFactor}`)
        : null;

    for (const [index, interaction] of interactions.entries()) {
      // Close whatever the previous interaction opened, so its sheet cannot
      // sit on top of the next trigger.
      if (index > 0) {
        await dismissOverlay(page, SHEET_CLOSE, `${target.id}/${formFactor}`);
      }

      const stepLabel = `${target.id}/${formFactor} ${interaction.name}`;

      // Resolve before the timespan opens so the polling and DOM queries that
      // find the element are not inside the measured window.
      const trigger = await resolveUnique(page, interaction.trigger, stepLabel);

      await flow.startTimespan({
        ...timespanFlags(formFactor),
        name: interaction.name,
      });
      await press(page, trigger);
      await waitForSettle(page, interaction.settle, stepLabel);
      // Settling means the sheet is on screen, which is marginally earlier than
      // the presentation of the frame that completes the interaction. Holding
      // the window open keeps that inside the trace and costs nothing: INP is
      // the interaction's own latency, not the length of the window it was
      // measured in.
      await new Promise((resolve) => setTimeout(resolve, INTERACTION_DWELL_MS));
      await flow.endTimespan();
    }

    const flowResult = await flow.createFlowResult();
    const runContext = { cards, overlaysDismissed, ...(await capture.collect()) };

    if (WRITE_REPORTS) {
      await writeReport(flowResult, target, formFactor, sample);
    }

    return extract(flowResult, runContext, `${target.id}/${formFactor}`);
  } finally {
    await context.close();
  }
}

function extract(flowResult, runContext, label) {
  const navigation = flowResult.steps.find(
    (step) => step.lhr.gatherMode === 'navigation'
  );
  if (!navigation) throw new Error(`${label}: flow produced no navigation step`);

  const metrics = {};
  for (const [key, auditId] of Object.entries(NAVIGATION_METRICS)) {
    const value = navigation.lhr.audits?.[auditId]?.numericValue;
    metrics[key] = typeof value === 'number' ? value : null;
  }
  const score = navigation.lhr.categories?.performance?.score;
  metrics.perfScore = typeof score === 'number' ? score * 100 : null;

  const inp = {};
  for (const step of flowResult.steps) {
    if (step.lhr.gatherMode !== 'timespan') continue;
    const value = timespanInp(step.lhr);
    if (value == null) {
      // A 0 ms reading from an interaction that never happened is the one
      // outcome that would quietly invalidate the series.
      throw new Error(
        `${label}: "${step.name}" recorded no interaction - the click did not register`
      );
    }
    inp[step.name] = value;
  }

  return {
    metrics,
    inp,
    context: runContext,
    lighthouseVersion: navigation.lhr.lighthouseVersion,
  };
}

/**
 * Interaction latency for one timespan, in ms, or null if nothing registered.
 *
 * The classic audit is tried first so this keeps working - and stays a single
 * authoritative number - if a later Lighthouse starts populating it again in
 * timespan mode. Today it does not, so the value comes from summing the INP
 * insight's three subparts.
 */
function timespanInp(lhr) {
  const direct = lhr.audits?.[TIMESPAN_METRIC]?.numericValue;
  if (typeof direct === 'number') return direct;

  const table = lhr.audits?.[TIMESPAN_INSIGHT]?.details?.items?.find(
    (item) => item.type === 'table'
  );
  const subparts = table?.items ?? [];
  if (subparts.length === 0) return null;

  const total = subparts.reduce((sum, part) => sum + (part.duration ?? 0), 0);
  return total > 0 ? total : null;
}

function aggregate(samples, errors) {
  if (samples.length === 0) {
    return { metrics: {}, inp: {}, context: null, sampleCount: 0, errors };
  }

  const metrics = {};
  for (const key of [...Object.keys(NAVIGATION_METRICS), 'perfScore']) {
    metrics[key] = summarize(samples.map((s) => s.metrics[key]));
  }

  const inp = {};
  const interactionNames = new Set(samples.flatMap((s) => Object.keys(s.inp)));
  for (const name of interactionNames) {
    inp[name] = summarize(samples.map((s) => s.inp[name]));
  }

  const contexts = samples.map((s) => s.context);
  const context = {
    cards: summarize(contexts.map((c) => c.cards)),
    searchApiMs: summarize(contexts.map((c) => c.searchApiMs)),
    searchApiUrl: contexts.find((c) => c.searchApiUrl)?.searchApiUrl ?? null,
    overlays: contexts.find((c) => c.overlaysDismissed != null)?.overlaysDismissed ?? null,
    hasPromo: contexts.some((c) => c.hasPromo === true)
      ? true
      : contexts.some((c) => c.hasPromo === false)
        ? false
        : null,
    pageModules: contexts.find((c) => c.pageModules?.length)?.pageModules ?? null,
    slowestXhr: contexts.at(-1)?.slowestXhr ?? [],
  };

  return { metrics, inp, context, sampleCount: samples.length, errors };
}

async function writeReport(flowResult, target, formFactor, sample) {
  const { ReportGenerator } = await import(
    'lighthouse/report/generator/report-generator.js'
  );
  const dir = path.join(REPO_ROOT, 'reports', PERIOD);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${target.id}-${formFactor}-${sample}.html`),
    ReportGenerator.generateFlowReportHtml(flowResult)
  );
}

function filterBy(items, csv, keyOf) {
  if (!csv) return items;
  const wanted = new Set(csv.split(',').map((s) => s.trim()));
  const filtered = items.filter((item) => wanted.has(keyOf(item)));
  if (filtered.length === 0) throw new Error(`nothing matched filter "${csv}"`);
  return filtered;
}

function fmt(value) {
  return value == null ? 'n/a' : Math.round(value * 1000) / 1000;
}

main().catch((error) => {
  console.error(`[scan] ${error?.stack ?? error}`);
  process.exit(1);
});
