#!/usr/bin/env node
/**
 * Chrome UX Report history for each scanned page.
 *
 * This is the field counterpart to the lab scan: real users, 28-day rolling
 * window, p75. It settles what the lab numbers only approximate - and it lags,
 * so a fix ships about four weeks before this panel shows it.
 *
 * Every record is best effort. CrUX only publishes a URL once it clears an
 * undisclosed traffic threshold, so a search results page whose visits are
 * split across every destination and date combination will often return
 * NOT_FOUND, and some pages report on phones but not on desktop. That is an
 * expected outcome rather than a failure; the dashboard shows how many of the
 * 40 windows each page actually reported so a short line is not misread as a
 * sudden improvement.
 *
 * Six calls per run against a 150 queries/minute quota, and the whole
 * history comes back each time, so data/crux.json is overwritten rather than
 * appended.
 *
 * Requires CRUX_API_KEY. Missing key is a hard failure in CI but a skip
 * locally, so the dashboard can still be built without one.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ORIGIN, TARGETS } from './targets.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENDPOINT =
  'https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord';

const FORM_FACTORS = ['PHONE', 'DESKTOP'];
// 40 weekly collection periods is the API maximum, so the first run already
// carries roughly nine months of history rather than starting empty.
const COLLECTION_PERIOD_COUNT = 40;

const apiKey = process.env.CRUX_API_KEY;

if (!apiKey) {
  const message = 'CRUX_API_KEY is not set';
  if (process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true') {
    console.error(`[crux] ${message}`);
    process.exit(1);
  }
  console.warn(`[crux] ${message} - skipping (the dashboard will hide the field tab)`);
  process.exit(0);
}

/**
 * Exactly the pages the lab scans, so every row in the field tab has a
 * counterpart in the lab tab and the two can be read against each other.
 *
 * This deliberately excludes two things it used to carry. An origin-wide scope
 * ('All of tiket.com') was the only record guaranteed to exist, but it averages
 * flights and trains in with accommodation and answers a question this
 * dashboard is not about. The English (/en-id/) twins of these pages were here
 * as the reference that first exposed how much slower Indonesian is on phones;
 * that gap is documented in the README instead of occupying half the legend.
 */
const SCOPES = TARGETS.map((target) => ({
  id: target.id,
  label: target.label,
  kind: 'url',
  url: target.url,
}));

const records = {};
for (const scope of SCOPES) {
  records[scope.id] = {};

  for (const formFactor of FORM_FACTORS) {
    const query = { url: scope.url };
    const response = await fetch(`${ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...query,
        formFactor,
        collectionPeriodCount: COLLECTION_PERIOD_COUNT,
      }),
    });

    const body = await response.json();

    // A URL below CrUX's reporting threshold is a normal outcome: the page is
    // real, it just has too few reporting visitors for Google to publish it.
    if (response.status === 404) {
      records[scope.id][formFactor] = null;
      console.log(`[crux] ${scope.id} ${formFactor}: no field data (below CrUX threshold)`);
      continue;
    }

    if (!response.ok) {
      const detail = body?.error?.message ?? response.statusText;
      throw new Error(
        `[crux] ${scope.id} ${formFactor} request failed (${response.status}): ${detail}`
      );
    }

    records[scope.id][formFactor] = body.record;
    const periods = body.record?.collectionPeriods?.length ?? 0;
    const metrics = Object.keys(body.record?.metrics ?? {});
    console.log(
      `[crux] ${scope.id} ${formFactor}: ${periods} periods, metrics: ${metrics.join(', ')}`
    );
  }
}

const covered = SCOPES.filter((scope) =>
  FORM_FACTORS.some((formFactor) => records[scope.id][formFactor])
);
console.log(
  `[crux] ${covered.length}/${SCOPES.length} scopes have data: ${covered.map((s) => s.id).join(', ')}`
);

const outPath = path.join(REPO_ROOT, 'data', 'crux.json');
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(
  outPath,
  `${JSON.stringify(
    { fetchedAt: new Date().toISOString(), origin: ORIGIN, scopes: SCOPES, records },
    null,
    2
  )}\n`
);
console.log(`[crux] wrote ${path.relative(REPO_ROOT, outPath)}`);
