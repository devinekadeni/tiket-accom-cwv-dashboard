/**
 * The pages measured, in the lab and in the field.
 *
 * Targets are the Indonesian (/id-id/) pages: they carry the bulk of the
 * traffic, and CrUX shows them behaving very differently from the English ones
 * on phones.
 *
 * These were once richer - each target also carried the selectors for an
 * interaction to measure INP against, plus overlay dismissal and network
 * patterns for run context. All of that belonged to a local Puppeteer harness
 * that no longer exists, because the site's bot protection would not reliably
 * let an automated browser load the pages. PageSpeed Insights only navigates,
 * so a URL is all it needs. The selectors are in git history if a browser-driven
 * scan ever becomes viable again.
 */

export const ORIGIN = 'https://www.tiket.com';

export const TARGETS = [
  {
    id: 'landing',
    label: 'Hotel landing',
    url: `${ORIGIN}/id-id/hotel`,
  },
  {
    id: 'srp',
    label: 'Hotel SRP (Jakarta)',
    // No date params, so the URL cannot go stale.
    url: `${ORIGIN}/id-id/hotel/search?room=1&adult=1&id=jakarta-108001534490276204&type=REGION&q=Jakarta`,
  },
  {
    id: 'pdp',
    label: 'Hotel PDP (Kempinski Jakarta)',
    // Chosen because CrUX publishes it: it is the only tiket detail page found
    // above the reporting threshold, so it is the one PDP where the lab number
    // and the field number describe the same URL and can be read against each
    // other. Every English PDP probed returns no field data at all.
    url: `${ORIGIN}/id-id/hotel/indonesia/hotel-indonesia-kempinski-jakarta-108001534490372415`,
  },
];

/**
 * Pages tracked in the field but never scanned in the lab.
 *
 * The English mirror of the scanned pages. Locale sits in the URL path, so CrUX
 * counts `/id-id/hotel` and `/en-id/hotel` as separate pages, and they are
 * nowhere near equivalent: on phones the Indonesian landing page reported an
 * LCP p75 around 9.9s against 2.8s for the English one over the same 28-day
 * window, while desktop was near identical on both. The lab scans Indonesian
 * because that is where the traffic is; English stays here as the reference
 * that made the gap visible in the first place.
 *
 * There is no English PDP scope: every en-id hotel page probed was below the
 * CrUX reporting threshold, so it would only ever render as "not published".
 */
export const FIELD_ONLY_SCOPES = [
  {
    id: 'landing-en',
    label: 'Hotel landing - English',
    url: `${ORIGIN}/en-id/hotel`,
  },
  {
    id: 'srp-en',
    label: 'Hotel SRP - English',
    // CrUX aggregates after dropping the query string, so the bare path is what
    // it reports against; sending the full search URL would resolve here anyway.
    url: `${ORIGIN}/en-id/hotel/search`,
  },
];
