/**
 * Detects a bot challenge served in place of the page.
 *
 * The site sits behind Cloudflare bot management, which intermittently answers
 * an automated browser with an interstitial instead of the real page. That is
 * survivable; recording it as a measurement is not.
 *
 * The interstitial is a tiny self-contained document, so it produces numbers
 * that look excellent rather than obviously broken: the first CI run measured
 * ~400ms LCP and 0.001 CLS identically across the landing page, the SRP and the
 * PDP, with a 6ms TTFB, and committed all of it as real data.
 *
 * Mobile catches this on its own, because the interaction trigger it needs is
 * missing, but desktop only navigates and so has nothing to trip over. This is
 * the check that makes it fail loudly on both.
 */

/** Interstitial titles, in both languages the site serves them in. */
const CHALLENGE_TITLE =
  /just a moment|robot atau manusia|attention required|verifying you are human|sedang memverifikasi/i;

/**
 * Markup Cloudflare injects for the challenge widget. Checked alongside the
 * title so a silent retitling does not defeat this on its own.
 */
const CHALLENGE_MARKUP = [
  '#challenge-form',
  '#challenge-running',
  '#cf-chl-widget',
  'script[src*="challenge-platform"]',
];

/**
 * Throw unless the page really is the site.
 *
 * @param {import('puppeteer').Page} page
 * @param {string} label used in the error, e.g. "srp/desktop"
 */
export async function assertNotChallenged(page, label) {
  const state = await page.evaluate((selectors) => {
    return {
      title: document.title,
      marker: selectors.find((selector) => document.querySelector(selector)) ?? null,
    };
  }, CHALLENGE_MARKUP);

  if (CHALLENGE_TITLE.test(state.title) || state.marker) {
    const reason = state.marker ? `matched ${state.marker}` : `title "${state.title}"`;
    throw new Error(
      `${label}: served a bot challenge instead of the page (${reason}) - ` +
        `no measurement taken`
    );
  }
}

/** Requests only the interstitial makes; Cloudflare's other /cdn-cgi/ assets
 * appear on perfectly normal pages, so this must stay narrow. */
const CHALLENGE_REQUEST = /\/cdn-cgi\/challenge-platform\//i;

/**
 * A real tiket.com page is megabytes. Anything this small did not render the
 * site, whether that is an interstitial, an error page or a redirect stub.
 */
const IMPLAUSIBLE_BYTES = 100_000;

/**
 * The same guarantee for a result measured elsewhere.
 *
 * PageSpeed Insights runs Lighthouse on Google's own machines, so there is no
 * live page left to inspect - only the report. The interstitial is still
 * recognisable in it, by the challenge assets it loads and by being orders of
 * magnitude too small to be the site.
 *
 * @param {object} lhr a Lighthouse result
 * @param {string} label used in the error, e.g. "srp/desktop"
 */
export function assertLhrNotChallenged(lhr, label) {
  const requests = lhr?.audits?.['network-requests']?.details?.items ?? [];
  const marker = requests.find((item) => CHALLENGE_REQUEST.test(item.url ?? ''));
  if (marker) {
    throw new Error(
      `${label}: served a bot challenge instead of the page (${marker.url}) - ` +
        `no measurement taken`
    );
  }

  const bytes = lhr?.audits?.['total-byte-weight']?.numericValue;
  if (typeof bytes === 'number' && bytes < IMPLAUSIBLE_BYTES) {
    throw new Error(
      `${label}: page weighed ${Math.round(bytes / 1024)}KB, far too small to be ` +
        `the real page - no measurement taken`
    );
  }
}

/** Path only: query strings and trailing slashes are normalised by the site. */
function pathOf(url) {
  try {
    return new URL(url).pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/**
 * Throw unless the report is of the page that was asked for.
 *
 * The challenge checks above only prove that something substantial rendered.
 * A hotel being delisted, or a region id changing under the SRP, gets a 404 or
 * a redirect to the landing page - a full-weight render of the wrong page,
 * which passes every check above and would be recorded as the target's own
 * numbers. Nothing in the trend would look wrong; the PDP line would just step.
 *
 * @param {object} lhr a Lighthouse result
 * @param {string} requestedUrl the URL the scan asked for
 * @param {string} label used in the error, e.g. "pdp/mobile"
 */
export function assertLhrIsRequestedPage(lhr, requestedUrl, label) {
  const requests = lhr?.audits?.['network-requests']?.details?.items ?? [];
  const document = requests.find((item) => item.resourceType === 'Document');
  const status = document?.statusCode;
  if (typeof status === 'number' && status >= 400) {
    throw new Error(
      `${label}: ${requestedUrl} returned HTTP ${status} - the page is gone or ` +
        `moved, no measurement taken`
    );
  }

  const landed = pathOf(lhr?.finalDisplayedUrl ?? lhr?.finalUrl ?? '');
  const asked = pathOf(requestedUrl);
  if (landed && asked && landed !== asked) {
    throw new Error(
      `${label}: asked for ${asked} but landed on ${landed} - no measurement taken`
    );
  }
}
