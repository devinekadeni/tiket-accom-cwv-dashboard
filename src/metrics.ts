import type { MetricKey, Series } from './types';

export type MetricDef = {
  key: MetricKey;
  label: string;
  short: string;
  unit: 'ms' | 'score' | 'unitless';
  good: number;
  poor: number;
  /** Performance score is the one metric where a bigger number is better. */
  higherIsBetter?: boolean;
  note?: string;
};

/** Google's published thresholds. TBT and Speed Index are lab-only guidance. */
export const LAB_METRICS: MetricDef[] = [
  {
    key: 'lcp',
    label: 'Largest Contentful Paint',
    short: 'LCP',
    unit: 'ms',
    good: 2500,
    poor: 4000,
    note: 'Dominated by the search API wait, so expect a wide variance band.',
  },
  {
    key: 'cls',
    label: 'Cumulative Layout Shift',
    short: 'CLS',
    unit: 'unitless',
    good: 0.1,
    poor: 0.25,
    note: 'Highly sensitive to which promo modules the page returned that week.',
  },
  {
    key: 'fcp',
    label: 'First Contentful Paint',
    short: 'FCP',
    unit: 'ms',
    good: 1800,
    poor: 3000,
  },
  {
    key: 'ttfb',
    label: 'Time to First Byte',
    short: 'TTFB',
    unit: 'ms',
    good: 800,
    poor: 1800,
  },
  {
    key: 'tbt',
    label: 'Total Blocking Time',
    short: 'TBT',
    unit: 'ms',
    good: 200,
    poor: 600,
  },
  {
    key: 'speedIndex',
    label: 'Speed Index',
    short: 'SI',
    unit: 'ms',
    good: 3400,
    poor: 5800,
  },
  {
    key: 'perfScore',
    label: 'Performance score',
    short: 'Score',
    unit: 'score',
    good: 90,
    poor: 50,
    higherIsBetter: true,
  },
];

export const INP_METRIC: Omit<MetricDef, 'key'> & { key: string } = {
  key: 'inp',
  label: 'Interaction to Next Paint',
  short: 'INP',
  unit: 'ms',
  good: 200,
  poor: 500,
};

export type Rating = 'good' | 'needs-improvement' | 'poor';

export function rate(def: Pick<MetricDef, 'good' | 'poor' | 'higherIsBetter'>, value: number): Rating {
  if (def.higherIsBetter) {
    if (value >= def.good) return 'good';
    return value >= def.poor ? 'needs-improvement' : 'poor';
  }
  if (value <= def.good) return 'good';
  return value <= def.poor ? 'needs-improvement' : 'poor';
}

export function formatValue(unit: MetricDef['unit'], value: number | null): string {
  if (value == null) return '-';
  if (unit === 'ms') return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
  if (unit === 'score') return String(Math.round(value));
  return value.toFixed(3);
}

export function seriesKey(series: Pick<Series, 'targetId' | 'formFactor'>): string {
  return `${series.targetId}|${series.formFactor}`;
}

/**
 * One hue per target so the three pages stay distinguishable, with desktop as
 * the lighter shade of the same hue.
 */
const TARGET_HUES: Record<string, [string, string]> = {
  landing: ['#1d4ed8', '#93c5fd'],
  srp: ['#b91c1c', '#fca5a5'],
  pdp: ['#047857', '#6ee7b7'],
  // Field-only series, which have no lab counterpart. The Indonesian pages get
  // their own hues rather than a shade of their English twin: the two locales
  // are compared directly and often diverge by several seconds, so they need to
  // be told apart at a glance rather than read as a variant of one line.
  origin: ['#6d28d9', '#c4b5fd'],
  'landing-id': ['#c2410c', '#fdba74'],
  'srp-id': ['#a21caf', '#f0abfc'],
  'pdp-id': ['#a16207', '#fde047'],
};

const FALLBACK_HUES: [string, string] = ['#6d28d9', '#c4b5fd'];

export function seriesColor(targetId: string, formFactor: string): string {
  const [mobile, desktop] = TARGET_HUES[targetId] ?? FALLBACK_HUES;
  return formFactor === 'mobile' ? mobile : desktop;
}

export function formFactorLabel(formFactor: string): string {
  return formFactor.charAt(0).toUpperCase() + formFactor.slice(1);
}

export function seriesLabel(
  series: Pick<Series, 'targetId' | 'formFactor'>,
  targetLabels: Record<string, string>
): string {
  return `${targetLabels[series.targetId] ?? series.targetId} - ${series.formFactor}`;
}
