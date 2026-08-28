#!/usr/bin/env node
/**
 * Chrome UX Report history for the tiket.com origin and, where it exists, for
 * each scanned page.
 *
 * This is the field counterpart to the lab scan: real users, 28-day rolling
 * window, p75. It settles what the lab numbers only approximate - and it lags,
 * so a fix ships about four weeks before this panel shows it.
 *
 * URL-level records are best effort. CrUX only publishes a URL once it clears
 * an undisclosed traffic threshold, so a search results page whose visits are
 * split across every destination and date combination will usually return
 * NOT_FOUND. That is an expected outcome here, not a failure: the origin record
 * always exists and the page records fill in wherever Google has the data.
 *
 * Fourteen calls per week against a 150 queries/minute quota, and the whole
 * history comes back each time, so data/crux.json is overwritten rather than
 * appended.
 *
 * Requires CRUX_API_KEY. Missing key is a hard failure in CI but a skip
 * locally, so the dashboard can still be built without one.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ORIGIN, TARGETS, FIELD_ONLY_SCOPES } from './targets.mjs';

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
 * The origin first, then one scope per scanned page so the field tab can offer
 * the same page breakdown as the lab tab wherever the data supports it, then
 * the pages that exist only in the field.
 *
 * The scanned pages are all English, and their labels say so here because the
 * Indonesian twins sit beside them in the same chart. Labels have to be unique
 * for the legend and tooltips to be readable at all.
 */
const SCOPES = [
  { id: 'origin', label: 'All of tiket.com', kind: 'origin', url: ORIGIN },
  ...TARGETS.map((target) => ({
    id: target.id,
    label: `${target.label} - English`,
    kind: 'url',
    url: target.url,
  })),
  ...FIELD_ONLY_SCOPES.map((scope) => ({ ...scope, kind: 'url' })),
];

const records = {};
for (const scope of SCOPES) {
  records[scope.id] = {};

  for (const formFactor of FORM_FACTORS) {
    const query = scope.kind === 'origin' ? { origin: scope.url } : { url: scope.url };
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

    // A URL below CrUX's reporting threshold is a normal outcome; the same
    // answer for the origin means something is actually wrong.
    if (response.status === 404 && scope.kind === 'url') {
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
