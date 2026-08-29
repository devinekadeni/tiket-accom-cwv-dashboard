/**
 * The pages measured, in the lab and in the field.
 *
 * These three are the whole scope of the dashboard: the Indonesian (/id-id/)
 * landing page, search results and a hotel detail page, each on mobile and
 * desktop. Indonesian because that is where the traffic is, and because CrUX
 * shows these pages behaving very differently from the English ones on phones.
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

