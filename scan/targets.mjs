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
    label: 'Hotel PDP (Aston Anyer Beach)',
    // The busiest hotel detail page according to the SEO and product teams,
    // which is the only sound basis for picking one: a PDP is a stand-in for
    // thousands of near-identical pages, so it should be the one real users
    // actually land on.
    //
    // It reports 19 of CrUX's 40 windows on phones and none on desktop. That is
    // not a property of this URL. Seven PDPs were probed, including four
    // five-star hotels in Jakarta's CBD, and only one had ever published desktop
    // data at all - 2 windows, stale since April. Hotel traffic is spread across
    // thousands of URLs and skews heavily mobile here, so no single detail page
    // sustains a desktop record. PSI still measures desktop in the lab; it is
    // only the field half of the PDP row that is phone-only.
    url: `${ORIGIN}/id-id/hotel/indonesia/aston-anyer-beach-hotel-112001545187309377`,
  },
];

