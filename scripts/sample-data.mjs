#!/usr/bin/env node
/**
 * Fabricates a plausible history into data/sample/ so the dashboard can be
 * looked at before real weeks exist. Nothing here is a measurement.
 *
 * Writes outside data/runs/ on purpose - that directory is committed wholesale
 * by the workflow, and invented weeks sitting in the real history would be very
 * hard to spot months later. data/sample/ is gitignored.
 *
 *   node scripts/sample-data.mjs && pnpm run dev:sample
 *   rm -rf data/sample          # when you are done looking
 *
 * Baselines are the real numbers measured against production on 13 Aug 2026, so
 * the magnitudes and the relationships between pages are honest even though the
 * week-to-week movement is invented.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const OUT_DIR = path.resolve('data/sample');
const WEEKS = 10;
const ORIGIN = 'https://www.tiket.com';

const BASE = {
  landing: {
    label: 'Hotel landing',
    url: 'https://www.tiket.com/en-id/hotel',
    mobile: {
      metrics: { lcp: 6280, cls: 0.02, fcp: 2232, ttfb: 501, tbt: 3245, speedIndex: 6108, perfScore: 40 },
      inp: { 'open-destination-autocomplete': 315 },
      context: { cards: null, searchApiMs: null },
    },
    desktop: {
      metrics: { lcp: 2140, cls: 0.01, fcp: 902, ttfb: 288, tbt: 760, speedIndex: 2180, perfScore: 71 },
      inp: {},
      context: { cards: null, searchApiMs: null },
    },
  },
  srp: {
    label: 'Hotel SRP (Jakarta)',
    url: 'https://www.tiket.com/en-id/hotel/search?room=1&adult=1&id=jakarta-108001534490276204&type=REGION&q=Jakarta',
    mobile: {
      metrics: { lcp: 21400, cls: 0.27, fcp: 1954, ttfb: 431, tbt: 1014, speedIndex: 11469, perfScore: 28 },
      inp: { 'open-filter-sheet': 256, 'open-sort-sheet': 152 },
      context: { cards: 8, searchApiMs: 2489 },
    },
    desktop: {
      metrics: { lcp: 7300, cls: 0.09, fcp: 780, ttfb: 240, tbt: 410, speedIndex: 3900, perfScore: 55 },
      inp: {},
      context: { cards: 12, searchApiMs: 1180 },
    },
  },
  pdp: {
    label: 'Hotel PDP (Apurva Kempinski)',
    url: 'https://www.tiket.com/en-id/hotel/indonesia/the-apurva-kempinski-bali-202001550596500105',
    mobile: {
      metrics: { lcp: 18371, cls: 0.122, fcp: 3228, ttfb: 1194, tbt: 1089, speedIndex: 9489, perfScore: 34 },
      inp: { 'see-room': 532 },
      context: { cards: null, searchApiMs: 2029 },
    },
    desktop: {
      metrics: { lcp: 6500, cls: 0.04, fcp: 1010, ttfb: 430, tbt: 380, speedIndex: 3200, perfScore: 50 },
      inp: {},
      context: { cards: null, searchApiMs: 940 },
    },
  },
};

/** Seeded, so re-running produces the same history instead of a new one. */
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = rng(20260813);

/** Median with a min/max spread around it, wider for the noisier metrics. */
function spread(median, noise, decimals) {
  const low = median * (1 - noise * (0.6 + random() * 0.6));
  const high = median * (1 + noise * (0.7 + random() * 0.9));
  const round = (v) => (decimals ? Number(v.toFixed(decimals)) : Math.round(v));
  return { median: round(median), min: round(low), max: round(high), samples: 5 };
}

const isoWeek = (index) => `2026-W${String(24 + index).padStart(2, '0')}`;

await fs.rm(OUT_DIR, { recursive: true, force: true });
await fs.mkdir(path.join(OUT_DIR, 'runs'), { recursive: true });

for (let i = 0; i < WEEKS; i++) {
  // A promo campaign runs for three weeks in the middle. It inflates SRP layout
  // shift, which is the whole reason the run context is recorded - otherwise it
  // reads as a code regression.
  const promoWeek = i >= 4 && i <= 6;
  // The filter sheet degrades steadily over the last few weeks, which is the
  // kind of drift a weekly trend is meant to surface.
  const filterDrift = 1 + Math.max(0, i - 3) * 0.11;
  const failedSample = i === 7;

  const targets = {};
  for (const [id, base] of Object.entries(BASE)) {
    const formFactors = {};

    for (const formFactor of ['mobile', 'desktop']) {
      const source = base[formFactor];
      const wobble = () => 0.94 + random() * 0.12;

      const metrics = {};
      for (const [key, value] of Object.entries(source.metrics)) {
        let scaled = value * wobble();
        if (key === 'cls' && promoWeek && id === 'srp') scaled *= 1.45;
        if (key === 'lcp' && id === 'srp') scaled *= 0.9 + random() * 0.25;
        if (key === 'perfScore') scaled = Math.min(100, scaled);
        metrics[key] = spread(scaled, key === 'lcp' ? 0.22 : 0.09, key === 'cls' ? 4 : 0);
      }

      const inp = {};
      for (const [name, value] of Object.entries(source.inp)) {
        const drift = name === 'open-filter-sheet' ? filterDrift : 1;
        inp[name] = spread(value * drift * wobble(), 0.18, 0);
      }

      formFactors[formFactor] = {
        metrics,
        inp,
        context: {
          cards: source.context.cards == null ? null : spread(source.context.cards, 0.15, 0),
          searchApiMs:
            source.context.searchApiMs == null
              ? null
              : spread(source.context.searchApiMs * (promoWeek ? 1.3 : 1) * wobble(), 0.25, 0),
          searchApiUrl:
            source.context.searchApiMs == null
              ? null
              : `www.tiket.com/ms-gateway/tix-hotel-search/${id === 'srp' ? 'v4/search' : 'v3/room'}`,
          overlays: formFactor === 'mobile' ? ['app-install-modal', 'app-install-floating-cta'] : null,
          hasPromo: id === 'pdp' ? null : promoWeek,
          pageModules: id === 'pdp' ? null : promoWeek ? ['FLASH_SALE'] : ['TIXHOTEL'],
          slowestXhr: [],
        },
        sampleCount: failedSample && formFactor === 'mobile' ? 4 : 5,
        errors:
          failedSample && formFactor === 'mobile' && id === 'srp'
            ? [{ sample: 2, message: 'srp/mobile open-filter-sheet: no visible match' }]
            : [],
      };
    }

    targets[id] = { label: base.label, url: base.url, formFactors };
  }

  const run = {
    week: isoWeek(i),
    runAt: new Date(Date.UTC(2026, 5, 8 + i * 7, 2, 4, 0)).toISOString(),
    samples: 5,
    lighthouseVersion: '12.8.2',
    runner: { platform: 'linux', arch: 'x64', node: 'v20.18.1', ci: 'github-actions', commit: null },
    targets,
    sample: true,
  };

  await fs.writeFile(
    path.join(OUT_DIR, 'runs', `${run.week}.json`),
    `${JSON.stringify(run, null, 2)}\n`
  );
}

// --- Field data, shaped like a real CrUX History response.
const CRUX_METRICS = {
  largest_contentful_paint: 2900,
  interaction_to_next_paint: 214,
  cumulative_layout_shift: 0.09,
  first_contentful_paint: 1820,
  experimental_time_to_first_byte: 760,
};

const dateParts = (d) => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });

function cruxRecord(formFactor, scale, key, firstPopulated) {
  const metrics = {};
  for (const [name, base] of Object.entries(CRUX_METRICS)) {
    metrics[name] = {
      percentilesTimeseries: {
        p75s: Array.from({ length: 40 }, (_, i) => {
          // Windows before the page crossed the traffic threshold come back
          // null, which is most of the history for a thinly trafficked URL.
          if (i < firstPopulated) return null;
          const value = base * scale * (1 + Math.sin(i / 5) * 0.12 + (random() - 0.5) * 0.04);
          return name === 'cumulative_layout_shift' ? value.toFixed(2) : String(Math.round(value));
        }),
      },
    };
  }

  const collectionPeriods = Array.from({ length: 40 }, (_, i) => {
    const last = new Date(Date.UTC(2025, 10, 2) + i * 7 * 86_400_000);
    return {
      firstDate: dateParts(new Date(last.getTime() - 27 * 86_400_000)),
      lastDate: dateParts(last),
    };
  });

  return { key: { formFactor, ...key }, metrics, collectionPeriods };
}

// Mirrors what the real API returns, including the parts that look like bugs
// and are not: the English PDP missing entirely, the SRPs reported without
// their query string and populated in only a handful of windows, the Indonesian
// PDP on phones only, and the Indonesian landing page several times worse than
// its English twin on phones while matching it on desktop.
//
// `phone` and `desktop` are multipliers on CRUX_METRICS; null means the form
// factor is not published. `from` is the first populated window out of 40.
const CRUX_SCOPES = [
  {
    id: 'origin',
    label: 'All of tiket.com',
    kind: 'origin',
    url: ORIGIN,
    phone: 1,
    desktop: 0.6,
    from: 0,
  },
  {
    id: 'landing',
    label: 'Hotel landing - English',
    kind: 'url',
    url: `${ORIGIN}/en-id/hotel`,
    phone: 0.92,
    desktop: 0.55,
    from: 5,
  },
  {
    id: 'srp',
    label: 'Hotel SRP (Jakarta) - English',
    kind: 'url',
    url: `${ORIGIN}/en-id/hotel/search?room=1&adult=1&id=jakarta-108001534490276204&type=REGION&q=Jakarta`,
    matchedUrl: `${ORIGIN}/en-id/hotel/search`,
    phone: 1.24,
    desktop: 0.74,
    from: 38,
  },
  {
    id: 'pdp',
    label: 'Hotel PDP (Apurva Kempinski) - English',
    kind: 'url',
    url: `${ORIGIN}/en-id/hotel/indonesia/the-apurva-kempinski-bali-202001550596500105`,
    phone: null,
    desktop: null,
    from: 0,
  },
  {
    id: 'landing-id',
    label: 'Hotel landing - Indonesian',
    kind: 'url',
    url: `${ORIGIN}/id-id/hotel`,
    phone: 3.3,
    desktop: 0.58,
    from: 5,
  },
  {
    id: 'srp-id',
    label: 'Hotel SRP - Indonesian',
    kind: 'url',
    url: `${ORIGIN}/id-id/hotel/search`,
    phone: 3.4,
    desktop: 0.75,
    from: 34,
  },
  {
    id: 'pdp-id',
    label: 'Hotel PDP (Kempinski Jakarta) - Indonesian',
    kind: 'url',
    url: `${ORIGIN}/id-id/hotel/indonesia/hotel-indonesia-kempinski-jakarta-108001534490372415`,
    phone: 1.9,
    desktop: null,
    from: 28,
  },
];

const cruxRecords = {};
for (const scope of CRUX_SCOPES) {
  const key = scope.kind === 'origin' ? { origin: ORIGIN } : { url: scope.matchedUrl ?? scope.url };
  cruxRecords[scope.id] = {
    PHONE: scope.phone == null ? null : cruxRecord('PHONE', scope.phone, key, scope.from),
    DESKTOP: scope.desktop == null ? null : cruxRecord('DESKTOP', scope.desktop, key, scope.from),
  };
}

await fs.writeFile(
  path.join(OUT_DIR, 'crux.json'),
  `${JSON.stringify(
    {
      fetchedAt: new Date().toISOString(),
      origin: ORIGIN,
      scopes: CRUX_SCOPES.map(({ id, label, kind, url }) => ({ id, label, kind, url })),
      records: cruxRecords,
      sample: true,
    },
    null,
    2
  )}\n`
);

console.log(`[sample] wrote ${WEEKS} weeks + CrUX to data/sample/ (gitignored, not real data)`);
