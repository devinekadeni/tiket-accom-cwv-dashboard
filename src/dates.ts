/**
 * Period ids are calendar days ("2026-08-10") for both the lab runs and CrUX,
 * turned into dates here so the charts can show something a human reads as a
 * date. ISO week ids ("2026-W33") are still accepted because the lab used them
 * until the scan went twice-weekly, and a fork may still hold such a file.
 */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const DAY_MS = 86_400_000;

/** Monday of the given ISO week. Jan 4th is always in ISO week 1. */
export function isoWeekToDate(id: string): Date | null {
  const match = /^(\d{4})-W(\d{1,2})$/.exec(id);
  if (!match) return null;
  const [, year, week] = match;
  const jan4 = new Date(Date.UTC(Number(year), 0, 4));
  const isoDayOfWeek = (jan4.getUTCDay() + 6) % 7;
  const firstMonday = jan4.getTime() - isoDayOfWeek * DAY_MS;
  return new Date(firstMonday + (Number(week) - 1) * 7 * DAY_MS);
}

export function parsePeriod(id: string): Date | null {
  if (id.includes('W')) return isoWeekToDate(id);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(id);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

/** "20 Jan 2026" */
export function formatDate(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** "20 Jan", dropping the year except where it would be ambiguous. */
export function formatDateShort(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** YYYY-MM-DD, the format `<input type="date">` expects. */
export function toDateInput(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

export type PeriodLabels = {
  date: (id: string) => Date | null;
  /** Compact form for axis ticks. */
  axis: (id: string) => string;
  /** Full form, always with the year, for tooltips and titles. */
  full: (id: string) => string;
};

/**
 * Axis ticks drop the year to stay narrow, but a chart spanning New Year would
 * then read as if it looped, so December and January keep theirs. Keying the
 * rule off the date alone matters: Recharts thins ticks out to fit, so anything
 * positional - "the first tick", "changed since the previous tick" - would show
 * the year only when that particular tick happened to survive.
 */
export function buildPeriodLabels(ids: string[]): PeriodLabels {
  const dates = new Map<string, Date | null>();
  const axis = new Map<string, string>();
  const full = new Map<string, string>();

  ids.forEach((id) => {
    const date = parsePeriod(id);
    dates.set(id, date);
    if (!date) {
      axis.set(id, id);
      full.set(id, id);
      return;
    }
    const month = date.getUTCMonth();
    const nearYearBoundary = month === 11 || month === 0;
    axis.set(id, nearYearBoundary ? formatDate(date) : formatDateShort(date));
    full.set(id, formatDate(date));
  });

  return {
    date: (id) => dates.get(id) ?? null,
    axis: (id) => axis.get(id) ?? id,
    full: (id) => full.get(id) ?? id,
  };
}

/* --- Range filtering --- */

export type RangePreset = '7d' | '30d' | '3m' | 'all' | 'custom';

export type DateRange = {
  preset: RangePreset;
  /** Only meaningful when preset is 'custom'. Both are YYYY-MM-DD. */
  from: string;
  to: string;
};

export const DEFAULT_RANGE: DateRange = { preset: 'all', from: '', to: '' };

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '3m', label: 'Last 3 months' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom' },
];

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/** Inclusive bounds; null means unbounded on that side. */
export function rangeBounds(range: DateRange): { from: Date | null; to: Date | null } {
  if (range.preset === 'all') return { from: null, to: null };
  if (range.preset === 'custom') {
    return { from: parsePeriod(range.from), to: parsePeriod(range.to) };
  }

  const to = todayUtc();
  const from = new Date(to);
  if (range.preset === '7d') from.setUTCDate(from.getUTCDate() - 7);
  else if (range.preset === '30d') from.setUTCDate(from.getUTCDate() - 30);
  else from.setUTCMonth(from.getUTCMonth() - 3);
  return { from, to };
}

/** Period ids falling inside the range, in their original order. */
export function filterPeriods(ids: string[], range: DateRange): string[] {
  const { from, to } = rangeBounds(range);
  if (!from && !to) return ids;
  return ids.filter((id) => {
    const date = parsePeriod(id);
    if (!date) return true;
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
  });
}
