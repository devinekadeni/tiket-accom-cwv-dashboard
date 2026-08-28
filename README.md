# tiket.com accommodation - weekly Core Web Vitals

A weekly Lighthouse scan of three public production hotel pages, committed to git as JSON and
rendered as a static trend dashboard. Runs on GitHub Actions cron, costs nothing, and has no
database and no server.

Everything measured here is already public: anyone can run Lighthouse against these URLs or
query CrUX for the origin without credentials.

## How it works

```
GitHub Actions cron (Mon 02:00 UTC)
  -> scan/run.mjs        Lighthouse user flow, 5 samples per target per form factor
     -> data/runs/YYYY-Www.json    medians + min/max + run context   (~10 KB, committed)
     -> reports/                   full flow HTML reports            (Actions artifacts, 90d)
  -> scan/crux.mjs       CrUX History API, 40 weekly points          (data/crux.json, overwritten)
  -> scripts/rollup.mjs  data/ -> src/generated/history.json         (generated, never committed)
  -> vite build          static dashboard -> Cloudflare Pages
```

Git is the datastore. A week is about 10 KB, so 52 weeks is roughly 520 KB/year against
GitHub's 1 GB soft limit. Full Lighthouse reports are 0.5-2 MB each and would blow through that
inside a year, so they go to Actions artifacts instead. `history.json` is rebuilt at build time
rather than committed, because rewriting one growing aggregate file every week would put a full
copy into git history on every run.

## What is measured

| Target | URL |
| --- | --- |
| Landing | `/en-id/hotel` |
| SRP | `/en-id/hotel/search?...&q=Jakarta` (no date params, so it cannot go stale) |
| PDP | `/en-id/hotel/indonesia/the-apurva-kempinski-bali-...` |

Mobile (390x844, DPR 3, 4x CPU) and desktop (1440x900), five samples each.

Navigation steps use Lighthouse's simulated (Lantern) throttling, which has the lowest
run-to-run variance. Timespan steps use devtools throttling at the same CPU multiplier, because
INP is measured from real event timings and cannot be simulated. Interactions are mobile-only:
desktop filters are an inline sidebar rather than a sheet.

Interactions measured: the SRP filter sheet (the one that failed the 200 ms threshold in the
original analysis), the SRP sort sheet (a control - if both move together the cause is global),
the landing destination autocomplete, and the PDP "See rooms" button.

Every run also records context: the search API's response time, product card count, which page
modules came back, and which promos appeared. Without it a content change and a code regression
look identical on a chart - promo presence alone once moved mobile CLS from 0.02 to 0.39.

## Things production does that the harness has to work around

All verified live and re-checkable with `node scan/verify.mjs`. Run that after any front-end
release that touches these pages.

- **Two app-install promos block every interaction.** A full-screen modal covers all three
  targets on a cold session, and a floating CTA sits exactly on top of the PDP's "See rooms"
  button. Both are dismissed after load and before measurement. They still land during load, so
  they remain part of the navigation's CLS, which is what a first-time visitor experiences.
- **The mobile UI ignores mouse clicks.** It binds touch handlers, so the harness emulates touch
  and taps. A scripted `element.click()` would not work either - it is not a real user
  interaction, so Chrome's Event Timing API never records it and INP comes back as
  not-applicable.
- **The SRP filter chip has no test id.** It is found by a scoped CSS-module prefix plus exact
  text equality, because "Popular Filter" is a sibling and two marketing chips come and go from
  fixed positions. Adding `data-testid="chip-filter"` upstream would retire this.
- **Reloading the SRP renders it without the filter chips.** So the reset between two
  interactions on one page closes the bottom sheet rather than navigating again.
- **The PDP renders two `button-see-room` elements**, one collapsed to 0x0. Element resolution
  filters to visible matches and asserts exactly one, which is what disambiguates them.

Every lookup asserts a single visible match and fails loudly. Silently reporting 0 ms for an
interaction that never happened is the one failure mode that would quietly invalidate the trend.

## Accuracy caveats

- **Runner location.** GitHub runners sit in Azure US/Europe while tiket.com serves South-East
  Asia, and about 72% of LCP here is the search API wait, so absolute LCP reads meaningfully
  higher than local numbers. Week-over-week trends stay valid because the vantage point is
  constant. A self-hosted runner on Oracle Cloud's always-free Singapore tier is the fix if
  absolutes ever matter.
- **Every sample is a cold session**, so the app-install promos appear every time where a
  returning user would not see them. Constant bias, tolerable for trends.
- **Lab INP is an approximation** - scripted presses on one path, not the p75 of everything real
  users do. The CrUX tab is what settles it.
- **SRP content varies weekly** with inventory, promos and pricing. The context strip makes this
  explainable but not eliminable.
- **Lighthouse version changes shift scoring**, so it is recorded in every run file.

## Local use

```bash
pnpm install

pnpm run scan          # full scan, ~20-30 min
pnpm run crux          # needs CRUX_API_KEY, skipped locally without one
pnpm run dev           # dashboard against whatever is in data/

node scan/verify.mjs   # selector + context probe, no Lighthouse, ~90s
```

The scan takes env overrides for quick iteration:

```bash
SAMPLES=1 ONLY_TARGETS=srp ONLY_FORM_FACTORS=mobile WEEK=test pnpm run scan
HEADFUL=1 ONLY_TARGETS=srp node scan/verify.mjs
```

## Remaining setup

1. **CrUX API key.** The [CrUX API docs page](https://developer.chrome.com/docs/crux/api) has an
   "Enable the Chrome UX Report API" button that creates a project, enables the API and issues a
   key in one step. No billing account needed. Restrict it to the Chrome UX Report API, leave
   application restrictions as None (a CI runner has no fixed IP), then:
   ```bash
   gh secret set CRUX_API_KEY --repo devinekadeni/tiket-accom-cwv-dashboard
   ```
   Quota is 150 queries/minute; this job uses two per week. Until the secret exists the workflow
   still runs and the field tab stays hidden.

2. **Cloudflare Pages.** Create a Pages project named `tiket-accom-cwv`, then set
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repo secrets. The deploy step skips
   itself while the token is absent, and the built site is uploaded as an artifact regardless.
   Point `tiket-accom-cwv.devinekadeni.com` at the project for automatic TLS.

3. **Seed the trend.** Trigger the workflow manually two or three times and check the variance
   bands before reading anything into the line:
   ```bash
   gh workflow run weekly-cwv.yml --repo devinekadeni/tiket-accom-cwv-dashboard
   ```
   Runs land in the same ISO week file, so re-running overwrites rather than accumulating.
