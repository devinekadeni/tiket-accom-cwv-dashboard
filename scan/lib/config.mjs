/**
 * Lighthouse settings per form factor.
 *
 * Navigation steps use simulated (Lantern) throttling, which has the lowest
 * run-to-run variance and is what makes a weekly trend line something other
 * than noise. Timespan steps cannot be simulated - INP is measured from real
 * event timings - so they use devtools throttling at the same CPU multiplier.
 */

import { desktopConfig } from 'lighthouse';

// Lighthouse's own mobileSlow4G / desktopDense4G presets, inlined rather than
// imported from lighthouse/core internals so a minor upgrade cannot break us.
const MOBILE_SLOW_4G = {
  rttMs: 150,
  throughputKbps: 1.6 * 1024,
  requestLatencyMs: 150 * 3.75,
  downloadThroughputKbps: 1.6 * 1024 * 0.9,
  uploadThroughputKbps: 750 * 0.9,
  cpuSlowdownMultiplier: 4,
};

const DESKTOP_DENSE_4G = {
  rttMs: 40,
  throughputKbps: 10 * 1024,
  cpuSlowdownMultiplier: 1,
  requestLatencyMs: 0,
  downloadThroughputKbps: 0,
  uploadThroughputKbps: 0,
};

/**
 * `hasTouch` is load-bearing, not cosmetic: the mobile UI binds touch handlers,
 * and a mouse click on the filter chip is simply ignored. Lighthouse enables
 * touch emulation itself for a mobile form factor, so this keeps the standalone
 * probe behaving the same way the measured run does.
 */
export const VIEWPORTS = {
  mobile: {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  desktop: {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
};

const SCREEN_EMULATION = {
  mobile: {
    mobile: true,
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    disabled: false,
  },
  desktop: {
    mobile: false,
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    disabled: false,
  },
};

const THROTTLING = {
  mobile: MOBILE_SLOW_4G,
  desktop: DESKTOP_DENSE_4G,
};

/**
 * Desktop extends Lighthouse's own desktop preset rather than being assembled
 * by hand, because `formFactor: 'desktop'` as a flag does not change the user
 * agent - that lives in the preset - and tiket.com would otherwise serve the
 * mobile site into a 1440px viewport. Flags below still override the preset's
 * screen size.
 */
export function configFor(formFactor) {
  return formFactor === 'desktop' ? desktopConfig : undefined;
}

/** Flow-level flags: apply to navigation steps. */
export function navigationFlags(formFactor) {
  return {
    formFactor,
    screenEmulation: SCREEN_EMULATION[formFactor],
    throttlingMethod: 'simulate',
    throttling: THROTTLING[formFactor],
    onlyCategories: ['performance'],
  };
}

/**
 * Timespan overrides. Lantern cannot simulate an interaction - INP comes from
 * real event timings - so throttle the CPU for real at the same multiplier the
 * navigation was simulated at.
 */
export function timespanFlags(formFactor) {
  return {
    ...navigationFlags(formFactor),
    throttlingMethod: 'devtools',
  };
}

/** Metrics pulled from every navigation step, in dashboard display order. */
export const NAVIGATION_METRICS = {
  lcp: 'largest-contentful-paint',
  cls: 'cumulative-layout-shift',
  fcp: 'first-contentful-paint',
  ttfb: 'server-response-time',
  tbt: 'total-blocking-time',
  speedIndex: 'speed-index',
};

export const TIMESPAN_METRIC = 'interaction-to-next-paint';

/**
 * Where the interaction latency actually lives in a timespan.
 *
 * Lighthouse 12.8 leaves `interaction-to-next-paint` notApplicable in timespan
 * mode even when the tap was recorded properly - the browser files event-timing
 * entries with real interactionIds, the audit just does not consume them. This
 * insight does, split into input delay, processing duration and presentation
 * delay, and their sum is the same interaction latency.
 */
export const TIMESPAN_INSIGHT = 'inp-breakdown-insight';
