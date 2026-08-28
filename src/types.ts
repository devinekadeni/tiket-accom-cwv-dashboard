/** Shape of src/generated/history.json, produced by scripts/rollup.mjs. */

export type Point = {
  week: string;
  median: number | null;
  min: number | null;
  max: number | null;
};

export type MetricKey =
  | 'lcp'
  | 'cls'
  | 'fcp'
  | 'ttfb'
  | 'tbt'
  | 'speedIndex'
  | 'perfScore';

export type FormFactor = 'mobile' | 'desktop';

export type WeekMeta = {
  week: string;
  runAt: string;
  lighthouseVersion: string | null;
  samples: number | null;
  runner: {
    platform?: string;
    arch?: string;
    node?: string;
    ci?: string;
    commit?: string | null;
  } | null;
};

export type TargetMeta = {
  id: string;
  label: string;
  url: string;
};

export type ContextPoint = {
  week: string;
  cards: number | null;
  searchApiMs: number | null;
  hasPromo: boolean | null;
  overlays: string[] | null;
  pageModules: string[] | null;
  sampleCount: number;
  errorCount: number;
};

export type Series = {
  targetId: string;
  formFactor: FormFactor;
  metrics: Record<MetricKey, Point[]>;
  inp: Record<string, Point[]>;
  context: ContextPoint[];
};

export type CruxSeries = {
  periods: string[];
  metrics: Record<string, (number | null)[]>;
};

/**
 * The origin, plus one entry per scanned page. `formFactors` is empty when CrUX
 * has no record for that page - real users exist, but too few for Google to
 * publish.
 */
export type CruxScope = {
  id: string;
  label: string;
  kind: 'origin' | 'url';
  requestedUrl: string;
  /** What CrUX matched, which drops query strings. Null when there is no data. */
  effectiveUrl: string | null;
  formFactors: Record<string, CruxSeries>;
};

export type Crux = {
  fetchedAt: string;
  origin: string;
  scopes: CruxScope[];
} | null;

export type History = {
  generatedAt: string;
  weeks: WeekMeta[];
  targets: TargetMeta[];
  series: Series[];
  crux: Crux;
};
