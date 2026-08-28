#!/usr/bin/env node
/**
 * Weekly lab scan via the PageSpeed Insights API.
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
 * Writes data/runs/<week>.json in the same shape the local harness wrote, so
 * the rollup and dashboard are unchanged.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TARGETS } from './targets.mjs';
import { NAVIGATION_METRICS } from './lib/config.mjs';
import { summarize, isoWeek } from './lib/stats.mjs';
import { assertLhrNotChallenged } from './lib/challenge.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

// The CrUX key works if PageSpeed Insights is enabled on the same project,
// which is the usual setup, so fall back to it rather than demanding a second.
const API_KEY = process.env.PSI_API_KEY || process.env.CRUX_API_KEY;

const SAMPLES = Number(process.env.SAMPLES) || 5;
const WEEK = process.env.WEEK || isoWeek();

/** PSI's own name for each form factor. */
const STRATEGIES = { mobile: 'mobile', desktop: 'desktop' };

const RETRIES = 3;
/** PSI rate-limits per minute and occasionally 500s under load. */
const RETRY_BACKOFF_MS = 15_000;
/** Spacing between calls, well inside the per-minute quota. */
const PACE_MS = 1_000;

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
async function runPsi(url, strategy, label) {
  const query = new URLSearchParams({ url, strategy, category: 'performance' });
  if (API_KEY) query.set('key', API_KEY);

  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const response = await fetch(`${ENDPOINT}?${query}`);
    const body = await response.json();

    if (response.ok) {
      const lhr = body.lighthouseResult;
      if (!lhr) throw new Error(`${label}: PSI returned no Lighthouse result`);
      if (lhr.runtimeError?.code) {
        throw new Error(`${label}: ${lhr.runtimeError.code} - ${lhr.runtimeError.message}`);
      }
      return lhr;
    }

    lastError = body?.error?.message ?? `HTTP ${response.status}`;
    const transient = response.status === 429 || response.status >= 500;
    if (!transient || attempt === RETRIES) break;

    console.error(`[psi] ${label} attempt ${attempt} failed (${lastError}), retrying`);
    await sleep(RETRY_BACKOFF_MS * attempt);
  }

  throw new Error(`${label}: ${lastError}`);
}

/** Pull the metrics the dashboard charts out of a Lighthouse result. */
function extract(lhr, label) {
  assertLhrNotChallenged(lhr, label);

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
    week: WEEK,
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
    `[psi] week ${WEEK}, ${selectedTargets.length} targets x ` +
      `${selectedFormFactors.length} form factors x ${SAMPLES} samples`
  );

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
          const lhr = await runPsi(target.url, STRATEGIES[formFactor], sampleLabel);
          const metrics = extract(lhr, sampleLabel);
          run.lighthouseVersion ??= lhr.lighthouseVersion ?? null;
          collected.push(metrics);
          console.log(
            `[psi] ${sampleLabel} ok in ${Math.round((Date.now() - t0) / 1000)}s ` +
              `(lcp ${Math.round(metrics.lcp)}ms, cls ${metrics.cls})`
          );
        } catch (error) {
          errors.push({ sample, message: String(error?.message ?? error) });
          console.error(`[psi] ${sampleLabel} FAILED: ${error?.message ?? error}`);
        }
        await sleep(PACE_MS);
      }

      if (collected.length === 0) failures.push(label);
      run.targets[target.id].formFactors[formFactor] = aggregate(collected, errors);
    }
  }

  const minutes = ((Date.now() - startedAt) / 60_000).toFixed(1);
  const runPath = path.join(REPO_ROOT, 'data', 'runs', `${WEEK}.json`);

  // A partial week is a data point with a gap in it; a week where nothing
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
    await fs.appendFile(process.env.GITHUB_OUTPUT, `week=${WEEK}\n`);
  }

  if (failures.length > 0) {
    throw new Error(`no successful samples for: ${failures.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(`[psi] ${error.message}`);
  process.exit(1);
});
