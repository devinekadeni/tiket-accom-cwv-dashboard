#!/usr/bin/env node
/**
 * Reports how much field data CrUX actually holds for given URLs.
 *
 * Presence alone is not enough to decide whether a URL is worth charting: a
 * page can be published yet have most windows fall below the reporting
 * threshold, which draws a stub of a line. This prints reported-window counts
 * alongside the recent p75s so a candidate can be judged before it is wired
 * into the dashboard.
 *
 *   CRUX_API_KEY=... node scan/crux-coverage.mjs <url> [url...]
 *
 * Diagnostic only - writes nothing the dashboard reads.
 */

const ENDPOINT = 'https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord';
const FORM_FACTORS = ['PHONE', 'DESKTOP'];
const COLLECTION_PERIOD_COUNT = 40;
const RECENT = 6;

const apiKey = process.env.CRUX_API_KEY;
if (!apiKey) {
  console.error('[coverage] CRUX_API_KEY is not set');
  process.exit(1);
}

const urls = process.argv.slice(2).filter((arg) => arg.startsWith('http'));
if (urls.length === 0) {
  console.error('[coverage] usage: node scan/crux-coverage.mjs <url> [url...]');
  process.exit(1);
}

for (const url of urls) {
  console.log(`\n=== ${url}`);

  for (const formFactor of FORM_FACTORS) {
    const response = await fetch(`${ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, formFactor, collectionPeriodCount: COLLECTION_PERIOD_COUNT }),
    });

    if (response.status === 404) {
      console.log(`  ${formFactor.padEnd(8)} not published`);
      continue;
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      console.log(`  ${formFactor.padEnd(8)} error ${response.status}: ${body?.error?.message ?? ''}`);
      continue;
    }

    const { record } = await response.json();
    const periods = record?.collectionPeriods ?? [];
    const lcp = record?.metrics?.largest_contentful_paint?.percentilesTimeseries?.p75s ?? [];
    const cls = record?.metrics?.cumulative_layout_shift?.percentilesTimeseries?.p75s ?? [];
    const inp = record?.metrics?.interaction_to_next_paint?.percentilesTimeseries?.p75s ?? [];

    const reported = lcp.filter((value) => value != null).length;
    const recent = lcp
      .map((value, index) => [periods[index]?.lastDate, value])
      .filter(([, value]) => value != null)
      .slice(-RECENT)
      .map(([date, value]) => `${date.day}/${date.month}=${value}`)
      .join('  ');

    console.log(
      `  ${formFactor.padEnd(8)} ${reported}/${periods.length} windows` +
        `  latest LCP ${last(lcp) ?? '-'}  CLS ${last(cls) ?? '-'}  INP ${last(inp) ?? '-'}`
    );
    if (recent) console.log(`           recent LCP: ${recent}`);

    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

function last(values) {
  for (let index = values.length - 1; index >= 0; index--) {
    if (values[index] != null) return values[index];
  }
  return null;
}
