/**
 * Scan targets and their interaction hooks.
 *
 * Every element lookup goes through `resolveUnique()` in lib/interactions.mjs,
 * which asserts exactly one *visible* match. A silent 0 ms interaction is worse
 * than a failed run, so absence and ambiguity both throw.
 *
 * Selectors below were probed against production on 13 Aug 2026 with
 * `node scan/verify.mjs`. Re-run that after any release touching these pages.
 */

export const ORIGIN = 'https://www.tiket.com';

/**
 * Every sheet on these pages is the same BottomSheet component - there is no
 * `[role="dialog"]` anywhere - so one settle selector covers all of them. The
 * `File_localClass__` prefix survives the production build, so prefix matching
 * is immune to hash churn.
 */
const BOTTOM_SHEET = '[class*="BottomSheet_wrapper__"]';

export const TARGETS = [
  {
    id: 'landing',
    label: 'Hotel landing',
    url: 'https://www.tiket.com/en-id/hotel',
    // Timespan steps are mobile-only: desktop filters are an inline sidebar
    // rather than a sheet, and desktop interactions measure fast unthrottled.
    interactions: {
      mobile: [
        {
          name: 'open-destination-autocomplete',
          trigger: { selector: '[data-testid="destination-input"]' },
          settle: { selector: BOTTOM_SHEET },
        },
      ],
    },
    context: { cards: false, searchApi: null },
  },
  {
    id: 'srp',
    label: 'Hotel SRP (Jakarta)',
    // No date params, so the URL cannot go stale. The app appends a
    // searchSessionId client-side via replaceState, which is not a navigation.
    url: 'https://www.tiket.com/en-id/hotel/search?room=1&adult=1&id=jakarta-108001534490276204&type=REGION&q=Jakarta',
    interactions: {
      mobile: [
        {
          // The 256 ms interaction from the analysis - the most valuable series
          // here, and the only one failing the 200 ms threshold. This chip has
          // no data-testid and no aria-label, so it needs a scoped CSS-module
          // selector plus exact text:
          //
          // - The wrapper scope is required: FlashSaleTabContent_chips__ on the
          //   same page also renders Chip_chip__ buttons.
          // - The scope alone does not disambiguate. All 7 chips are direct
          //   children of that one wrapper, so "Popular Filter" is a sibling -
          //   exact text equality is what separates them, and a substring match
          //   would hit both.
          // - Position is not usable: the probe found two marketing chips
          //   ("Up to 50% off", "Concert Deals") sitting at indexes 2 and 3,
          //   and those come and go.
          name: 'open-filter-sheet',
          trigger: {
            selector:
              '[class*="SrpFilterChipsMobile_wrapper__"] > button[class*="Chip_chip__"]',
            text: 'Filter',
          },
          settle: { selector: BOTTOM_SHEET },
        },
        {
          // Measured 152 ms in the analysis, so it passes today. Kept as a
          // control series: if this and the filter sheet move together, the
          // cause is global rather than filter-specific.
          name: 'open-sort-sheet',
          trigger: { selector: '[data-testid="chip-sort-filter"]' },
          settle: { selector: BOTTOM_SHEET },
        },
      ],
    },
    context: { cards: true, searchApi: /tix-hotel-search\/v\d+\/search/i },
  },
  {
    id: 'pdp',
    label: 'Hotel PDP (Apurva Kempinski)',
    url: 'https://www.tiket.com/en-id/hotel/indonesia/the-apurva-kempinski-bali-202001550596500105',
    interactions: {
      mobile: [
        {
          // The primary conversion action on this page. Two buttons carry this
          // testid - one is collapsed to 0x0 - so the visibility filter in
          // resolveUnique is what makes it resolvable at all.
          name: 'see-room',
          trigger: { selector: '[data-testid="button-see-room"]' },
          // The room list is already in the DOM on load, so waiting for it to
          // exist would pass without the click doing anything. The button
          // scrolls to it, so scroll position is the real signal.
          settle: { inViewport: '[data-testid="room-list-container"]' },
        },
      ],
    },
    context: { cards: false, searchApi: /tix-hotel-search\/v\d+\/room/i },
  },
];

/**
 * Pages tracked in the field but never scanned in the lab.
 *
 * Locale sits in the URL path, so CrUX counts `/en-id/hotel` and `/id-id/hotel`
 * as separate pages - and they are nowhere near equivalent. On phones the
 * Indonesian landing page reported an LCP p75 around 9.9s against 2.8s for the
 * English one, on the same 28-day window, while desktop was near identical on
 * both. Indonesian is where the traffic is, so leaving it out made the field
 * tab look far healthier than the site actually is.
 *
 * The PDP is a different hotel as well as a different locale. Every en-id hotel
 * page probed was below the CrUX reporting threshold, including the one the lab
 * scans; this is the only tiket PDP found that Google publishes, so it is the
 * only way to see a detail page in field data at all.
 */
export const FIELD_ONLY_SCOPES = [
  {
    id: 'landing-id',
    label: 'Hotel landing - Indonesian',
    url: `${ORIGIN}/id-id/hotel`,
  },
  {
    id: 'srp-id',
    label: 'Hotel SRP - Indonesian',
    // CrUX aggregates after dropping the query string, so the bare path is what
    // it reports against; sending the full search URL would resolve here anyway.
    url: `${ORIGIN}/id-id/hotel/search`,
  },
  {
    id: 'pdp-id',
    label: 'Hotel PDP (Kempinski Jakarta) - Indonesian',
    url: `${ORIGIN}/id-id/hotel/indonesia/hotel-indonesia-kempinski-jakarta-108001534490372415`,
  },
];

/**
 * App-install promos, dismissed after load and before any measurement.
 *
 * Both appear on all three targets on a cold session, and both intercept taps:
 * the modal covers the entire viewport, and the floating CTA sits exactly on
 * top of the PDP's "See rooms" button. Without dismissing them, no interaction
 * can be measured at all.
 *
 * Dismissal happens outside the timespan. The promos still land during load, so
 * they remain part of the navigation's CLS, which is what a first-time visitor
 * actually experiences.
 */
export const OVERLAYS = [
  {
    name: 'app-install-modal',
    container: '[class*="BaseModal-module__modal_wrapper"]',
    // No testid and no aria-label on these buttons, so this needs the same
    // scoped-prefix plus exact-text approach as the filter chip.
    dismiss: {
      selector: '[class*="BaseModal-module__modal_wrapper"] button',
      text: 'Continue without promo',
    },
    // Injected a beat after load, so this waits rather than sampling once.
    timeoutMs: 10_000,
  },
  {
    name: 'app-install-floating-cta',
    container: '[class*="floating_popup"]',
    dismiss: { selector: '[class*="floating_popup"] button[aria-label="Close"]' },
    timeoutMs: 8_000,
  },
];

/**
 * Reset between two interactions on the same page.
 *
 * Re-navigating would be the obvious reset, but on the SRP the second load
 * renders without the filter-chip row at all, so the next interaction has
 * nothing to resolve. Closing the sheet restores the page exactly and is
 * faster.
 */
export const SHEET_CLOSE = {
  name: 'bottom-sheet',
  container: '[class*="BottomSheet_wrapper__"]',
  dismiss: { selector: '[class*="BottomSheet_close_button__"]' },
  timeoutMs: 3_000,
};

/** Product cards, counted after navigation as run context. */
export const CARD_SELECTORS = [
  '[data-testid="full-product-card"]',
  '[data-testid="accom-product-card"]',
];

/**
 * Content changes look identical to code regressions in a bare metric chart -
 * promo presence alone once moved mobile CLS from 0.02 to 0.39 on this site -
 * so every run records what the page actually contained.
 *
 * The search-API pattern is per target rather than global: the probe showed a
 * loose pattern matches nine requests on the SRP and picks the wrong one. The
 * request that matters is the slow one (v4/search measured 2.9s, and ~72% of
 * LCP is spent waiting on it), not the first one to come back.
 */
export const PAGE_MODULES_PATTERN = /page-modules-full/i;

/** Matched case-insensitively against the templateCode of each page module. */
export const PROMO_PATTERN = /promo|campaign|banner|flash|deal|voucher/i;

export const FORM_FACTORS = ['mobile', 'desktop'];

export const DEFAULT_SAMPLES = 5;
