#!/usr/bin/env node
/**
 * Build-time rollup: data/runs/*.json + data/crux.json -> src/generated/history.json.
 *
 * The aggregate is generated, never committed. Rewriting one growing file every
 * run would put a full copy of it into git history each time, which is the one
 * way this storage model could actually get expensive; the per-run files
 * are append-only and a few KB each.
 *
 * The dashboard imports the output statically, so there is no runtime fetch, no
 * CORS, and no backend.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = path.join(REPO_ROOT, 'src', 'generated', 'history.json');

// Overridable so `dev:sample` can point at throwaway data. Keeping sample runs
// out of data/runs/ matters: the workflow commits that directory wholesale, and
// fabricated runs landing in the real history would be hard to spot later.
const RUNS_DIR = path.resolve(REPO_ROOT, process.env.RUNS_DIR ?? 'data/runs');
const CRUX_PATH = path.resolve(REPO_ROOT, process.env.CRUX_PATH ?? 'data/crux.json');

const METRIC_KEYS = ['lcp', 'cls', 'fcp', 'ttfb', 'tbt', 'speedIndex', 'perfScore'];

const runs = await readRuns();
const history = {
  generatedAt: new Date().toISOString(),
  runs: runs.map((run) => ({
    period: run.period,
    runAt: run.runAt,
    lighthouseVersion: run.lighthouseVersion ?? null,
    samples: run.samples ?? null,
    runner: run.runner ?? null,
  })),
  targets: collectTargets(runs),
  series: buildSeries(runs),
  crux: await readCrux(),
};

await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
await fs.writeFile(OUT_PATH, `${JSON.stringify(history)}\n`);

console.log(
  `[rollup] ${runs.length} run(s), ${history.series.length} series -> ` +
    `${path.relative(REPO_ROOT, OUT_PATH)}`
);

async function readRuns() {
  let files;
  try {
    files = await fs.readdir(RUNS_DIR);
  } catch {
    console.warn('[rollup] no data/runs yet - building an empty dashboard');
    return [];
  }

  const parsed = [];
  for (const file of files.filter((f) => f.endsWith('.json')).sort()) {
    const raw = await fs.readFile(path.join(RUNS_DIR, file), 'utf8');
    parsed.push(JSON.parse(raw));
  }
  // Period ids are YYYY-MM-DD, which sorts lexicographically into chronological
  // order. They were ISO week ids until the scan started running twice a week,
  // when a second run would have overwritten the first one's file.
  return parsed.sort((a, b) => a.period.localeCompare(b.period));
}

function collectTargets(runs) {
  const targets = new Map();
  for (const run of runs) {
    for (const [id, target] of Object.entries(run.targets ?? {})) {
      targets.set(id, { id, label: target.label, url: target.url });
    }
  }
  return [...targets.values()];
}

/**
 * One series per target x form factor, each metric a period-indexed array. Periods
 * a target did not produce become null so the chart draws a gap rather than
 * interpolating across a failed run.
 */
function buildSeries(runs) {
  const keys = new Map();
  for (const run of runs) {
    for (const [targetId, target] of Object.entries(run.targets ?? {})) {
      for (const formFactor of Object.keys(target.formFactors ?? {})) {
        keys.set(`${targetId}|${formFactor}`, { targetId, formFactor });
      }
    }
  }

  return [...keys.values()].map(({ targetId, formFactor }) => {
    const perPeriod = runs.map((run) => ({
      period: run.period,
      data: run.targets?.[targetId]?.formFactors?.[formFactor] ?? null,
    }));

    const metrics = {};
    for (const key of METRIC_KEYS) {
      metrics[key] = perPeriod.map(({ period, data }) => point(period, data?.metrics?.[key]));
    }

    const interactionNames = new Set(
      perPeriod.flatMap(({ data }) => Object.keys(data?.inp ?? {}))
    );
    const inp = {};
    for (const name of interactionNames) {
      inp[name] = perPeriod.map(({ period, data }) => point(period, data?.inp?.[name]));
    }

    const context = perPeriod.map(({ period, data }) => ({
      period,
      cards: data?.context?.cards?.median ?? null,
      searchApiMs: data?.context?.searchApiMs?.median ?? null,
      hasPromo: data?.context?.hasPromo ?? null,
      overlays: data?.context?.overlays ?? null,
      pageModules: data?.context?.pageModules ?? null,
      sampleCount: data?.sampleCount ?? 0,
      errorCount: data?.errors?.length ?? 0,
    }));

    return { targetId, formFactor, metrics, inp, context };
  });
}

function point(period, summary) {
  if (!summary) return { period, median: null, min: null, max: null };
  return { period, median: summary.median, min: summary.min, max: summary.max };
}

/**
 * Flatten the CrUX history response into parallel arrays, one entry per scope
 * (the origin, plus each page CrUX had data for). The API returns p75 as a
 * string for unitless metrics like CLS, and null for periods with too little
 * traffic, so both are normalised here rather than in the chart.
 *
 * Scopes with no data at all are kept: the dashboard says so explicitly, which
 * is more useful than a page silently missing from the breakdown.
 */
async function readCrux() {
  let raw;
  try {
    raw = await fs.readFile(CRUX_PATH, 'utf8');
  } catch {
    console.warn('[rollup] no data/crux.json - the field tab will be hidden');
    return null;
  }

  const { fetchedAt, origin, scopes, records } = JSON.parse(raw);

  const out = (scopes ?? []).map((scope) => {
    const formFactors = {};
    let effectiveUrl = null;

    for (const [formFactor, record] of Object.entries(records?.[scope.id] ?? {})) {
      if (!record) continue;

      // CrUX answers with the URL it actually matched, which is not always the
      // one asked for - query strings are dropped, so the Jakarta search URL
      // resolves to every hotel search. Carried through so the dashboard can
      // label the series honestly.
      effectiveUrl ??= record.key?.url ?? record.key?.origin ?? null;

      const periods = (record.collectionPeriods ?? []).map(
        ({ lastDate }) =>
          `${lastDate.year}-${String(lastDate.month).padStart(2, '0')}-${String(lastDate.day).padStart(2, '0')}`
      );

      const metrics = {};
      for (const [name, metric] of Object.entries(record.metrics ?? {})) {
        const p75s = metric?.percentilesTimeseries?.p75s;
        if (!p75s) continue;
        metrics[name] = p75s.map((value) => (value == null ? null : Number(value)));
      }

      formFactors[formFactor] = { periods, metrics };
    }

    return {
      id: scope.id,
      label: scope.label,
      kind: scope.kind,
      requestedUrl: scope.url,
      effectiveUrl,
      formFactors,
    };
  });

  const withData = out.filter((scope) => Object.keys(scope.formFactors).length > 0).length;
  console.log(`[rollup] crux: ${withData}/${out.length} scopes with field data`);

  return { fetchedAt, origin, scopes: out };
}
