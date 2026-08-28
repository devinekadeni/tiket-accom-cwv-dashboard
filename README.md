# tiket.com accommodation - Core Web Vitals

A Lighthouse scan of three public production hotel pages, run after each deploy day, committed to
git as JSON and rendered as a static trend dashboard. Runs on GitHub Actions cron, costs nothing,
and has no database and no server.

Everything measured here is already public: anyone can run PageSpeed Insights against these URLs
or query CrUX for the origin without credentials.

## How it works

```
GitHub Actions cron (Mon + Thu 21:00 UTC = Tue + Fri 04:17 WIB)
  -> scan/psi.mjs        PageSpeed Insights, 5 samples per target per form factor
     -> data/runs/YYYY-MM-DD.json  medians + min/max              (~6 KB, committed)
  -> scan/crux.mjs       CrUX History API, 40 weekly points       (data/crux.json, overwritten)
  -> scripts/rollup.mjs  data/ -> src/generated/history.json      (generated, never committed)
  -> vite build          static dashboard -> Cloudflare Pages
```

Twice a week rather than weekly because the team deploys on Monday and Thursday. One run per
deploy window is enough to attribute a change: each run is the reading after the deploy that just
happened and the baseline before the next, so a gap between two runs contains exactly one deploy.
They fire in the small hours local time, which leaves margin for a deploy that ran late, lets
caches warm, and keeps server-side timings comparable run to run.

Git is the datastore. A run is about 6 KB, so ~100 runs a year is well under GitHub's 1 GB soft
limit. `history.json` is rebuilt at build time rather than committed, because rewriting one
growing aggregate file on every run would put a full copy into git history each time.

## What is measured

| Target | URL |
| --- | --- |
| Landing | `/id-id/hotel` |
| SRP | `/id-id/hotel/search?...&q=Jakarta` (no date params, so it cannot go stale) |
| PDP | `/id-id/hotel/indonesia/hotel-indonesia-kempinski-jakarta-...` |

The Indonesian pages, not the English ones. Locale is part of the path, so CrUX treats them as
separate pages, and they behave very differently: Indonesian carries the bulk of real traffic and
has run several seconds slower on phones for the same metric and window while matching English on
desktop. The English landing and SRP remain in the field tab as the reference that made the gap
visible. There is no English PDP scope, because no `/en-id/` hotel page clears CrUX's reporting
threshold.

Mobile and desktop at PageSpeed Insights' own presets, five samples each, plotted as the median
with the min/max spread behind it. The spread is not decoration - independent runs of the same
page minutes apart have differed by several seconds.

## Why PageSpeed Insights rather than our own browser

The scan used to drive headless Chrome through a Lighthouse user flow. That is the more capable
approach: it can script a real press and so measure INP, and it can watch the page's own network
traffic to record context like the search API's response time and how many product cards came
back.

It could not be relied on. The site is behind Cloudflare bot management, which intermittently
serves an automated browser a challenge screen instead of the page - reliably so from GitHub's
runners. The failure is not a gap in the data but a plausible one: the interstitial is a tiny
self-contained document, so it measures as an excellent page. One CI run published a full week at
roughly 400 ms LCP and 0.001 CLS identically across all three pages, with a 6 ms TTFB and zero
cards on a search results page, before it was caught.

PSI runs the same Lighthouse from Google's infrastructure, which the site does admit. The cost is
INP and the run context; navigation metrics are unaffected.

Both paths now refuse to record a challenge screen: the live one checks the page before reading
anything off it, and the PSI one checks the returned report for the challenge assets and for a
page implausibly small to be the site.

## The local harness

`pnpm run scan:local` still drives a real browser and is the only way to get INP. It works
whenever the challenge is not being served, which locally is most of the time. It is not in CI.

Notes that apply only to it, all re-checkable with `node scan/verify.mjs`:

- **Two app-install promos block every interaction.** A full-screen modal covers all three
  targets on a cold session, and a floating CTA sits exactly on top of the PDP's "See rooms"
  button. Both are dismissed after load and before measurement.
- **The mobile UI ignores mouse clicks.** It binds touch handlers, so the harness taps.
- **The SRP filter chip has no test id.** It is found by a scoped CSS-module prefix plus exact
  text equality, because "Filter Populer" is a sibling. The label happens to be "Filter" in both
  languages. Adding `data-testid="chip-filter"` upstream would retire this.
- **The PDP renders two `button-see-room` elements**, one collapsed to 0x0. Element resolution
  filters to visible matches and asserts exactly one.
- **Lighthouse 12.8 does not populate `interaction-to-next-paint` in timespan mode** even when the
  tap registers, so INP is read from `inp-breakdown-insight` instead. `scan/probe-inp.mjs` is the
  instrumentation that established this, and distinguishes "the input never landed" from
  "Lighthouse did not attribute it".
- **Text selectors are locale-specific.** `node scan/probe-locale.mjs` prints the current strings.

## Accuracy caveats

- **PSI caches.** A repeat request for the same URL returns the previous report. Samples are
  therefore taken in rounds - every URL once, then round again - and any sample whose analysis
  timestamp repeats the previous one is rejected. Without that the min/max band would have been
  zero-width, which reads as unusually stable performance rather than as a broken measurement.
- **Google's vantage point, not your users'.** Absolute numbers reflect where PSI runs from and
  its throttling presets, and will not match a local run. Trends stay valid because the vantage
  point is constant; the field tab is what reports reality.
- **No INP here.** The field tab has it as the p75 of what users actually did.
- **CrUX drops query strings.** The SRP is reported as `/id-id/hotel/search`, aggregating every
  search. The dashboard shows the URL CrUX actually matched when it differs from the one asked
  for.
- **Sparse CrUX coverage.** Pages below the reporting threshold return nothing for some windows,
  and the PDP has no desktop data at all. Each scope shows how many of its windows reported.
- **Lighthouse version changes shift scoring**, so it is recorded in every run file.

## Local use

```bash
pnpm install

pnpm run scan          # PageSpeed Insights, ~30 min, needs an API key
pnpm run scan:local    # real browser, ~20 min, adds INP, blocked when challenged
pnpm run crux          # needs CRUX_API_KEY
pnpm run dev           # dashboard against whatever is in data/
pnpm run dev:sample    # dashboard against generated sample data

node scan/verify.mjs   # selector probe for the local harness, no Lighthouse, ~90s
```

Both scans take env overrides for quick iteration:

```bash
SAMPLES=1 ONLY_TARGETS=srp ONLY_FORM_FACTORS=mobile WEEK=test pnpm run scan
HEADFUL=1 ONLY_TARGETS=srp node scan/verify.mjs
```

`WEEK` overrides the run's period id, which is otherwise the Jakarta calendar date. Use it for
throwaway runs so they do not land on a real one; delete the file afterwards, since the workflow
commits `data/` wholesale.

## Remaining setup

1. **API key.** One Google Cloud key serves both APIs. The
   [CrUX API docs page](https://developer.chrome.com/docs/crux/api) has an "Enable the Chrome UX
   Report API" button that creates a project, enables the API and issues a key in one step, with
   no billing account. Then enable **PageSpeed Insights API** on the same project, and if the key
   has API restrictions, add PSI alongside Chrome UX Report or the calls are rejected. Leave
   application restrictions as None, since a CI runner has no fixed IP.
   ```bash
   gh secret set CRUX_API_KEY --repo devinekadeni/tiket-accom-cwv-dashboard
   ```
   Both are already set. Changes take a few minutes to propagate, during which calls fail with a
   403 telling you to enable something that is already enabled; the scan retries those.

2. **Cloudflare Pages.** Create a Pages project named `tiket-accom-cwv`, then set
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repo secrets. The deploy step skips
   itself while the token is absent, and the built site is uploaded as an artifact regardless.
   Point `tiket-accom-cwv.devinekadeni.com` at the project for automatic TLS.

3. **Seed the trend.** Runs are keyed by date, so triggering the workflow twice in one day
   overwrites rather than accumulating. Let the schedule build the history, or pass `WEEK` for a
   one-off:
   ```bash
   gh workflow run cwv-scan.yml --repo devinekadeni/tiket-accom-cwv-dashboard
   ```
