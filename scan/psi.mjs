#!/usr/bin/env node
/**
 * Lab scan via the PageSpeed Insights API, run after each deploy day.
 *
 * Replaces driving Lighthouse locally. The site is behind Cloudflare bot
 * management, which intermittently serves an automated browser an interstitial
 * instead of the page - reliably so from CI, where a whole week of ~400ms LCP
 * readings turned out to be measurements of the challenge screen. PSI runs the
 * same Lighthouse on Google's infrastructure, which the site does admit, so the
 * measurement stops depending on whether we look like a bot.
 *
 * What that costs is real and worth stating: PSI only loads a page, so the INP
 * interaction series is gone, and so is the run context we used to gather by
 * intercepting the page's own network traffic - card counts, search API timing,
 * promo presence. Navigation metrics are unaffected.
 *
 * Numbers are not comparable with the previous local runs: different hardware,
 * a different network location and Lighthouse's own throttling presets rather
 * than ours.
 *
 *   PSI_API_KEY=... node scan/psi.mjs
 *   SAMPLES=1 ONLY_TARGETS=srp node scan/psi.mjs
 *
 * Writes data/runs/<date>.json, keyed by `period` - the Jakarta calendar date
 * of the run - in the same shape the local harness writes.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TARGETS } from './targets.mjs';
import { NAVIGATION_METRICS } from './lib/config.mjs';
import { summarize, runDate } from './lib/stats.mjs';
import { assertLhrNotChallenged, assertLhrIsRequestedPage } from './lib/challenge.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

// The CrUX key works if PageSpeed Insights is enabled on the same project,
// which is the usual setup, so fall back to it rather than demanding a second.
const API_KEY = process.env.PSI_API_KEY || process.env.CRUX_API_KEY;

const SAMPLES = Number(process.env.SAMPLES) || 5;
const PERIOD = process.env.PERIOD || runDate();

/** PSI's own name for each form factor. */
const STRATEGIES = { mobile: 'mobile', desktop: 'desktop' };

const RETRIES = 3;
/** PSI rate-limits per minute and occasionally 500s under load. */
const RETRY_BACKOFF_MS = 15_000;

/**
 * Minimum spacing between two calls for the same URL and strategy.
 *
 * PSI serves a cached report to a repeat request: five back-to-back calls came
 * back byte-identical, sharing one analysisUTCTimestamp, which would have made
 * the min/max band pure decoration. A repeat 90s later re-analysed. Samples are
 * therefore taken in rounds - every URL once, then round again - so the gap is
 * filled with useful work instead of sleeping, and this is only the floor that
 * catches a run narrow enough that a round finishes too quickly.
 */
const MIN_GAP_MS = 95_000;

const selectedTargets = filterBy(TARGETS, process.env.ONLY_TARGETS, (t) => t.id);
const selectedFormFactors = filterBy(
  Object.keys(STRATEGIES),
  process.env.ONLY_FORM_FACTORS,
  (f) => f
);

function filterBy(items, csv, key) {
  if (!csv) return items;
  const wanted = new Set(csv.split(',').map((s) => s.trim()));
  const picked = items.filter((item) => wanted.has(key(item)));
  if (picked.length === 0) throw new Error(`nothing matched "${csv}"`);
  return picked;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One PSI run. Retries transient failures - quota and 5xx - but not a refusal
 * to measure, which will not improve by asking again.
 */
/**
 * Enabling the API, or widening a key's restrictions, reaches Google's serving
 * fleet unevenly for several minutes: calls fail with a 403 telling you to
 * enable something that is already enabled, in between calls that succeed.
 */
const PROPAGATING = /has not been used in project|blocked|wait a few minutes/i;

async function runPsi(url, strategy, label) {
  const query = new URLSearchParams({ url, strategy, category: 'performance' });
  if (API_KEY) query.set('key', API_KEY);

  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const response = await fetch(`${ENDPOINT}?${query}`);

    // Under load Google answers with an HTML error page rather than JSON, which
    // would otherwise throw straight past the retry below and lose the sample.
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      lastError = `non-JSON response (HTTP ${response.status})`;
      if (attempt === RETRIES) break;
      console.error(`[psi] ${label} attempt ${attempt} failed (${lastError}), retrying`);
      await sleep(RETRY_BACKOFF_MS * attempt);
      continue;
    }

    if (response.ok) {
      const lhr = body.lighthouseResult;
      if (!lhr) throw new Error(`${label}: PSI returned no Lighthouse result`);
      if (lhr.runtimeError?.code) {
        throw new Error(`${label}: ${lhr.runtimeError.code} - ${lhr.runtimeError.message}`);
      }
      return { lhr, analysedAt: body.analysisUTCTimestamp ?? null };
    }

    lastError = body?.error?.message ?? `HTTP ${response.status}`;
    const transient =
      response.status === 429 ||
      response.status >= 500 ||
      (response.status === 403 && PROPAGATING.test(lastError));
    if (!transient || attempt === RETRIES) break;

    console.error(
      `[psi] ${label} attempt ${attempt} failed (${lastError.slice(0, 80)}), retrying`
    );
    await sleep(RETRY_BACKOFF_MS * attempt);
  }

  throw new Error(`${label}: ${lastError}`);
}

/** Pull the metrics the dashboard charts out of a Lighthouse result. */
function extract(lhr, url, label) {
  assertLhrNotChallenged(lhr, label);
  assertLhrIsRequestedPage(lhr, url, label);

  const metrics = {};
  for (const [key, auditId] of Object.entries(NAVIGATION_METRICS)) {
    const value = lhr.audits?.[auditId]?.numericValue;
    metrics[key] = typeof value === 'number' ? value : null;
  }

  const score = lhr.categories?.performance?.score;
  metrics.perfScore = typeof score === 'number' ? score * 100 : null;

  if (metrics.lcp == null) {
    throw new Error(`${label}: result had no LCP, so it measured nothing useful`);
  }
  return metrics;
}

function aggregate(samples, errors) {
  if (samples.length === 0) {
    return { metrics: {}, inp: {}, context: null, sampleCount: 0, errors };
  }

  const metrics = {};
  for (const key of [...Object.keys(NAVIGATION_METRICS), 'perfScore']) {
    metrics[key] = summarize(samples.map((s) => s[key]));
  }

  // inp and context stay empty: PSI cannot script an interaction, and the page's
  // own network traffic is not ours to observe when Google does the loading.
  return { metrics, inp: {}, context: null, sampleCount: samples.length, errors };
}

async function main() {
  if (!API_KEY) {
    throw new Error('PSI_API_KEY (or CRUX_API_KEY) is required');
  }

  const startedAt = Date.now();
  const run = {
    period: PERIOD,
    runAt: new Date().toISOString(),
    samples: SAMPLES,
    source: 'pagespeed-insights',
    lighthouseVersion: null,
    runner: {
      ci: process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local',
      commit: process.env.GITHUB_SHA ?? null,
    },
    targets: {},
  };

  const failures = [];
  console.log(
    `[psi] run ${PERIOD}, ${selectedTargets.length} targets x ` +
      `${selectedFormFactors.length} form factors x ${SAMPLES} samples`
  );

  const combos = selectedTargets.flatMap((target) =>
    selectedFormFactors.map((formFactor) => ({
      key: `${target.id}/${formFactor}`,
      target,
      formFactor,
      collected: [],
      errors: [],
    }))
  );

  const lastCallAt = new Map();
  const lastAnalysedAt = new Map();

  // Sample-major, so each URL is revisited only after every other one has been
  // measured and its cached report has had time to expire.
  for (let sample = 1; sample <= SAMPLES; sample++) {
    for (const combo of combos) {
      const sampleLabel = `${combo.key} #${sample}`;
      const since = Date.now() - (lastCallAt.get(combo.key) ?? -Infinity);
      if (since < MIN_GAP_MS) await sleep(MIN_GAP_MS - since);

      const t0 = Date.now();
      try {
        const { lhr, analysedAt } = await runPsi(
          combo.target.url,
          STRATEGIES[combo.formFactor],
          sampleLabel
        );
        lastCallAt.set(combo.key, Date.now());

        // Timing alone is not proof the report is new, and a repeat of an
        // earlier one would narrow the variance band rather than widen it -
        // the failure would look like unusually stable performance.
        if (analysedAt && analysedAt === lastAnalysedAt.get(combo.key)) {
          throw new Error(`PSI returned its cached report from ${analysedAt}`);
        }
        lastAnalysedAt.set(combo.key, analysedAt);

        const metrics = extract(lhr, combo.target.url, sampleLabel);
        run.lighthouseVersion ??= lhr.lighthouseVersion ?? null;
        combo.collected.push(metrics);
        console.log(
          `[psi] ${sampleLabel} ok in ${Math.round((Date.now() - t0) / 1000)}s ` +
            `(lcp ${Math.round(metrics.lcp)}ms, cls ${metrics.cls})`
        );
      } catch (error) {
        lastCallAt.set(combo.key, Date.now());
        combo.errors.push({ sample, message: String(error?.message ?? error) });
        console.error(`[psi] ${sampleLabel} FAILED: ${error?.message ?? error}`);
      }
    }
  }

  for (const combo of combos) {
    const entry = (run.targets[combo.target.id] ??= {
      label: combo.target.label,
      url: combo.target.url,
      formFactors: {},
    });
    if (combo.collected.length === 0) failures.push(combo.key);
    entry.formFactors[combo.formFactor] = aggregate(combo.collected, combo.errors);
  }

  const minutes = ((Date.now() - startedAt) / 60_000).toFixed(1);
  const runPath = path.join(REPO_ROOT, 'data', 'runs', `${PERIOD}.json`);

  // A partial run is a data point with a gap in it; a run where nothing
  // succeeded is not a data point, and committing it would put an empty entry
  // into the trend.
  const total = selectedTargets.length * selectedFormFactors.length;
  if (failures.length === total) {
    console.error(`[psi] nothing succeeded in ${minutes} min, writing no run file`);
    throw new Error(`no successful samples for: ${failures.join(', ')}`);
  }

  await fs.mkdir(path.dirname(runPath), { recursive: true });
  await fs.writeFile(runPath, `${JSON.stringify(run, null, 2)}\n`);
  console.log(`[psi] wrote ${path.relative(REPO_ROOT, runPath)} in ${minutes} min`);

  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, `period=${PERIOD}\n`);
  }

  if (failures.length > 0) {
    throw new Error(`no successful samples for: ${failures.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(`[psi] ${error.message}`);
  process.exit(1);
});
