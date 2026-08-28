/**
 * Median of 5 with min/max kept alongside. The min/max is not decoration: LCP
 * here inherits the search API's variance, so a chart plotting only the median
 * would imply a precision the measurement does not have.
 */
export function summarize(values) {
  const clean = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (clean.length === 0) return null;

  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  return {
    median: round(median),
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
    samples: clean.length,
  };
}

/** CLS needs 4 decimals to be readable; millisecond metrics do not. */
function round(value) {
  return Math.abs(value) < 1 ? Number(value.toFixed(4)) : Math.round(value);
}

/**
 * Timezone the schedule is reasoned about in. Runs are aimed at the small hours
 * after a deploy day, which is a Jakarta-local idea, not a UTC one.
 */
const SCHEDULE_TZ = 'Asia/Jakarta';

/**
 * Period id for a run: the calendar date in Jakarta, e.g. 2026-09-01.
 *
 * Runs used to be identified by ISO week, which broke as soon as there was more
 * than one a week - the second would overwrite the first. Dates sort
 * lexicographically into chronological order just as week ids did, and the
 * dashboard already parses them, since CrUX periods are dates too.
 *
 * Jakarta rather than UTC because the schedule fires just after local midnight:
 * by UTC the run is still the previous day, so it would file itself under the
 * deploy day it is measuring rather than the morning after.
 */
export function runDate(date = new Date()) {
  // en-CA is the locale that formats as YYYY-MM-DD.
  return date.toLocaleDateString('en-CA', { timeZone: SCHEDULE_TZ });
}
