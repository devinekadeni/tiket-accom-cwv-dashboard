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
| SRP | `/id-id/hotel/search?...&q=Bandung` (no date params, so it cannot go stale) |
| PDP | `/id-id/hotel/indonesia/aston-anyer-beach-hotel-...` (the busiest detail page) |

These three pages on mobile and desktop are the entire scope, in both tabs: the lab tab scans
them and the field tab reads CrUX for the same URLs, so the two can be compared row for row.

One caveat on the SRP. CrUX drops the query string, so every destination and date collapses into a
single record for `/id-id/hotel/search`: the field row describes all hotel searches, and changing
the destination cannot change it. The destination does decide what the lab loads, which is why it is
Bandung - the busiest search - though the page is slow whichever city you ask for. Bandung and
Jakarta measured 18.0s and 16.4s LCP on mobile.

The Indonesian pages, not the English ones. Locale is part of the path, so CrUX treats them as
separate pages, and they behave very differently: Indonesian carries the bulk of real traffic and
has run several seconds slower on phones for the same metric and window while matching English on
desktop - the Indonesian landing page measured 7.08s LCP p75 against 2.63s for English, with
desktop at 2.42s and 2.30s. The English pages were tracked alongside for a while to establish
that; they are not any more, because the finding is recorded here and the dashboard is about the
pages the team ships.

The field tab also used to carry an origin-wide scope. It was dropped for the same reason: it
blends flights and trains into the accommodation numbers.

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
self-contained document, so it measures as an excellent page. One CI run published an entire scan at
roughly 400 ms LCP and 0.001 CLS identically across all three pages, with a 6 ms TTFB and zero
cards on a search results page, before it was caught.

PSI runs the same Lighthouse from Google's infrastructure, which the site does admit. The cost is
INP and the run context; navigation metrics are unaffected.

The scan refuses to record a challenge screen: it checks the returned report for the challenge
assets and for a page implausibly small to be the site. It also refuses a report of the wrong
page - a 4xx, or a redirect away from the URL asked for - since a delisted hotel would otherwise
render at full weight and land in the trend as the PDP's own numbers.

## The removed harness

A local Puppeteer harness used to drive a real browser through a scripted press on each page,
which is what made INP and the run context measurable. It was deleted once PSI became the weekly
source: keeping a second, unused measurement path in the tree only invited it to drift and be
trusted later. `lighthouse` and `puppeteer` went with it, so the scan workspace now has no
dependencies at all.

Its selector work is in git history rather than lost, along with what it took to make the pages
scriptable - two app-install promos that intercept every tap, a mobile UI that ignores mouse
clicks because it binds touch handlers, an SRP filter chip with no test id that needs exact text
equality to separate it from "Filter Populer", and a PDP that renders two `button-see-room`
elements, one collapsed to 0x0. One upstream change would retire most of that if a browser-driven
scan ever becomes viable again: `data-testid` attributes on those controls.

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
pnpm run crux          # needs CRUX_API_KEY
pnpm run dev           # dashboard against whatever is in data/
pnpm run dev:sample    # dashboard against generated sample data
```

The scan takes env overrides for quick iteration:

```bash
SAMPLES=1 ONLY_TARGETS=srp ONLY_FORM_FACTORS=mobile PERIOD=test pnpm run scan
```

`PERIOD` overrides the run's period id, which is otherwise the Jakarta calendar date. Use it for
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

2. **Cloudflare Pages.** The project exists and is live at
   <https://tiket-accom-cwv.pages.dev>, deployed by hand with
   `wrangler pages deploy dist --project-name=tiket-accom-cwv --branch=main`.

   For the workflow to publish each run, set `CLOUDFLARE_API_TOKEN` (an account token with
   *Cloudflare Pages: Edit*) and `CLOUDFLARE_ACCOUNT_ID` as repo secrets. Until then the deploy
   step **skips silently** rather than failing, so a green run does not mean the site was
   updated - the build is uploaded as an artifact either way.
   ```bash
   gh secret set CLOUDFLARE_API_TOKEN --repo devinekadeni/tiket-accom-cwv-dashboard
   gh secret set CLOUDFLARE_ACCOUNT_ID --repo devinekadeni/tiket-accom-cwv-dashboard
   ```
   A custom domain is still to come; `*.pages.dev` carries its own TLS in the meantime.

3. **Seed the trend.** Runs are keyed by date, so triggering the workflow twice in one day
   overwrites rather than accumulating. Let the schedule build the history, or pass `PERIOD` for a
   one-off:
   ```bash
   gh workflow run cwv-scan.yml --repo devinekadeni/tiket-accom-cwv-dashboard
   ```
