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

/** ISO 8601 week id, e.g. 2026-W33. */
export function isoWeek(date = new Date()) {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  // Thursday of the current week determines the year the week belongs to.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
