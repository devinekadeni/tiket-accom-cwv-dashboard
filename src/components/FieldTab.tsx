import { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ResponsiveContainer,
} from 'recharts';

import type { Crux, CruxScope } from '../types';
import { buildPeriodLabels, filterPeriods, type DateRange } from '../dates';
import { formFactorLabel, formatValue, seriesColor } from '../metrics';
import { AXIS_WIDTH, ThresholdTick, buildTicks, thresholdsCrowded } from './ThresholdAxis';

/** CrUX metric ids mapped to labels and the thresholds they are judged against. */
const FIELD_METRICS: Record<
  string,
  { label: string; unit: 'ms' | 'unitless'; good: number; poor: number }
> = {
  largest_contentful_paint: { label: 'LCP', unit: 'ms', good: 2500, poor: 4000 },
  interaction_to_next_paint: { label: 'INP', unit: 'ms', good: 200, poor: 500 },
  cumulative_layout_shift: { label: 'CLS', unit: 'unitless', good: 0.1, poor: 0.25 },
  first_contentful_paint: { label: 'FCP', unit: 'ms', good: 1800, poor: 3000 },
  experimental_time_to_first_byte: { label: 'TTFB', unit: 'ms', good: 800, poor: 1800 },
  round_trip_time: { label: 'Round-trip time', unit: 'ms', good: 100, poor: 300 },
};

const FORM_FACTOR_ORDER = ['DESKTOP', 'PHONE'];

type FieldSeries = {
  key: string;
  label: string;
  color: string;
  /** p75 by period, so a scope with its own period list still lines up. */
  values: Map<string, number | null>;
};

/**
 * A URL can be published by CrUX yet still have windows with too little traffic
 * to report, which come back null. Counting them matters: a page with two
 * populated windows out of forty draws a stub of a line that looks like a bug
 * rather than like thin data.
 */
function coverageOf(scope: CruxScope): { reported: number; total: number } {
  const periods = new Set<string>();
  const reported = new Set<string>();

  for (const series of Object.values(scope.formFactors)) {
    series.periods.forEach((period) => periods.add(period));
    for (const id of Object.keys(FIELD_METRICS)) {
      const values = series.metrics[id];
      if (!values) continue;
      series.periods.forEach((period, index) => {
        if (values[index] != null) reported.add(period);
      });
    }
  }

  return { reported: reported.size, total: periods.size };
}

export function FieldTab({ crux, range }: { crux: Crux; range: DateRange }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  if (!crux) {
    return (
      <p className="empty">
        No field data yet. Set the <code>CRUX_API_KEY</code> secret and re-run the workflow.
      </p>
    );
  }

  function toggle(key: string) {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const scopes = crux.scopes;
  const withData = scopes.filter((scope) => Object.keys(scope.formFactors).length > 0);

  const allPeriods = [
    ...new Set(
      withData.flatMap((scope) =>
        Object.values(scope.formFactors).flatMap((series) => series.periods)
      )
    ),
  ].sort();
  const periods = filterPeriods(allPeriods, range);
  const labels = buildPeriodLabels(periods);

  const metricIds = [
    ...new Set(
      withData.flatMap((scope) =>
        Object.values(scope.formFactors).flatMap((series) => Object.keys(series.metrics))
      )
    ),
  ]
    .filter((id) => id in FIELD_METRICS)
    .sort((a, b) => Object.keys(FIELD_METRICS).indexOf(a) - Object.keys(FIELD_METRICS).indexOf(b));

  const normalised = withData.filter(
    (scope) => scope.kind === 'url' && scope.effectiveUrl && scope.effectiveUrl !== scope.requestedUrl
  );
  const noData = scopes.filter((scope) => Object.keys(scope.formFactors).length === 0);

  return (
    <section>
      <div className="toggle-groups">
        {scopes.map((scope) => (
          <div key={scope.id} className="toggle-group">
            <span className="toggle-group-label">
              <span className="toggle-group-name">{scope.label}</span>
              <ScopeUrl scope={scope} />
              <Coverage scope={scope} />
            </span>
            <div className="toggle-group-chips">
              {formFactorsOf(scope).map((formFactor) => {
                const key = seriesKeyFor(scope.id, formFactor);
                return (
                  <button
                    key={key}
                    className={hidden.has(key) ? 'toggle toggle-off' : 'toggle'}
                    onClick={() => toggle(key)}
                    aria-pressed={!hidden.has(key)}
                    aria-label={`${scope.label} - ${formFactor.toLowerCase()}`}
                  >
                    <span
                      className="swatch"
                      style={{ background: colorFor(scope.id, formFactor) }}
                    />
                    {formFactorLabel(formFactor.toLowerCase())}
                  </button>
                );
              })}
              {formFactorsOf(scope).length === 0 && (
                <span className="muted">not published by CrUX</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="callout">
        <h2>How this data is collected</h2>
        <p>
          Chrome UX Report p75: real Chrome users who opted into reporting, aggregated by Google
          over a <strong>28-day rolling window</strong> and split by phone and desktop. Nothing
          is measured by this repo - the numbers are read from the CrUX History API, which
          returns the last 40 weekly snapshots of that window.
        </p>
        <p>
          This is what Google actually judges the site on, and it is the arbiter when the lab
          numbers disagree. It lags, though: a fix shipping today only starts to show up here
          about four weeks later, and reads fully correct once the window has rolled over
          completely. Each point is one window, so neighbouring points overlap by 27 days and
          move gradually by construction.
        </p>
        <p>
          Unlike the lab tab, the page breakdown is only as granular as Google publishes. A URL
          appears here once it clears an undisclosed traffic threshold, and CrUX aggregates by
          URL after dropping the query string.
          {normalised.length > 0 && (
            <>
              {' '}
              That is why <strong>{normalised.map((s) => s.label).join(', ')}</strong> covers
              every visit to{' '}
              {normalised.map((scope, index) => (
                <span key={scope.id}>
                  {index > 0 && ', '}
                  <code>{scope.effectiveUrl}</code>
                </span>
              ))}{' '}
              rather than only the exact URL the lab scan loads - so it is not a like-for-like
              comparison with the lab number for that page.
            </>
          )}
          {noData.length > 0 && (
            <>
              {' '}
              <strong>{noData.map((s) => s.label).join(', ')}</strong>{' '}
              {noData.length === 1 ? 'has' : 'have'} too little traffic to be published at all,
              so {noData.length === 1 ? 'it is' : 'they are'} lab-only.
            </>
          )}
        </p>
        <p>
          Locale is part of the path, so <code>/id-id/</code> and <code>/en-id/</code> are
          separate pages to CrUX and are listed separately here. Treating them as one page
          would be misleading: Indonesian carries the bulk of real traffic and has run several
          seconds slower on phones for the same metric and window, while matching English on
          desktop. The lab tab scans the Indonesian pages, so those rows line up with it; the
          English rows are here as the reference that made the gap visible.
        </p>
        <p className="muted">
          Fetched {new Date(crux.fetchedAt).toLocaleDateString()}.
        </p>
      </div>

      {periods.length === 0 && (
        <p className="empty">No field data in the selected range. Widen the date filter.</p>
      )}

      <div className="charts">
        {metricIds.map((id) => {
          const def = FIELD_METRICS[id];
          const series = buildSeries(withData, id).filter((s) => !hidden.has(s.key));

          const rows = periods.map((period) => {
            const row: Record<string, unknown> = { period };
            for (const s of series) row[s.key] = s.values.get(period) ?? null;
            return row;
          });

          const values = series.flatMap((s) =>
            periods.map((period) => s.values.get(period)).filter((v): v is number => v != null)
          );
          const upper = Math.max(
            values.length ? Math.max(...values) * 1.1 : def.poor,
            def.poor * 1.2
          );

          return (
            <figure className="chart" key={id}>
              <figcaption>
                <h3>{def.label}</h3>
              </figcaption>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
                  <ReferenceArea y1={0} y2={def.good} fill="#16a34a" fillOpacity={0.06} />
                  <ReferenceArea y1={def.good} y2={def.poor} fill="#f59e0b" fillOpacity={0.06} />
                  <ReferenceArea y1={def.poor} y2={upper} fill="#dc2626" fillOpacity={0.06} />
                  <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 10 }}
                    tickMargin={8}
                    interval="preserveStartEnd"
                    minTickGap={48}
                    tickFormatter={labels.axis}
                  />
                  <YAxis
                    width={AXIS_WIDTH}
                    domain={[0, upper]}
                    ticks={buildTicks(upper, def.good, def.poor)}
                    interval={0}
                    tick={
                      <ThresholdTick
                        unit={def.unit}
                        good={def.good}
                        poor={def.poor}
                        crowded={thresholdsCrowded(upper, def.good, def.poor)}
                      />
                    }
                  />
                  <Tooltip
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <div className="tooltip">
                          <strong>28 days ending {labels.full(String(label))}</strong>
                          {series.map((s) => {
                            const value = s.values.get(String(label));
                            if (value == null) return null;
                            return (
                              <div key={s.key} className="tooltip-row">
                                <span className="swatch" style={{ background: s.color }} />
                                <span className="tooltip-label">{s.label}</span>
                                <span className="tooltip-value">
                                  {formatValue(def.unit, value)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ) : null
                    }
                  />
                  {series.map((s) => {
                    // A handful of points would otherwise render as a stub of a
                    // line that is easy to miss entirely.
                    const populated = periods.filter(
                      (period) => s.values.get(period) != null
                    ).length;
                    return (
                      <Line
                        key={s.key}
                        type="monotone"
                        dataKey={s.key}
                        name={s.label}
                        stroke={s.color}
                        strokeWidth={2}
                        dot={populated <= 8 ? { r: 3 } : false}
                        isAnimationActive={false}
                        connectNulls={false}
                      />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            </figure>
          );
        })}
      </div>
    </section>
  );
}

function ScopeUrl({ scope }: { scope: CruxScope }) {
  const url = scope.effectiveUrl ?? scope.requestedUrl;
  const normalised = scope.effectiveUrl != null && scope.effectiveUrl !== scope.requestedUrl;
  const display = scope.kind === 'origin' ? 'origin-wide' : shortUrl(url);

  return (
    <a
      className="toggle-group-url"
      href={url}
      target="_blank"
      rel="noreferrer"
      title={
        normalised
          ? `CrUX reports this as ${url}, dropping the query string from ${scope.requestedUrl}`
          : url
      }
    >
      {display}
      {normalised && <span className="url-note"> (query dropped)</span>}
    </a>
  );
}

/** Only shown when it is not the full history, where it would just be noise. */
function Coverage({ scope }: { scope: CruxScope }) {
  const { reported, total } = coverageOf(scope);
  if (total === 0 || reported === total) return null;

  return (
    <span
      className="scope-coverage"
      title="Windows where this URL had enough traffic for CrUX to report a p75"
    >
      {reported} of {total} windows reported
    </span>
  );
}

function formFactorsOf(scope: CruxScope): string[] {
  return FORM_FACTOR_ORDER.filter((formFactor) => scope.formFactors[formFactor]);
}

function seriesKeyFor(scopeId: string, formFactor: string): string {
  return `${scopeId}|${formFactor}`;
}

/** Matches the lab tab's hue per page, so the same page reads the same in both. */
function colorFor(scopeId: string, formFactor: string): string {
  return seriesColor(scopeId, formFactor === 'PHONE' ? 'mobile' : 'desktop');
}

function buildSeries(scopes: CruxScope[], metricId: string): FieldSeries[] {
  const series: FieldSeries[] = [];

  for (const scope of scopes) {
    for (const formFactor of formFactorsOf(scope)) {
      const source = scope.formFactors[formFactor];
      const p75s = source.metrics[metricId];
      if (!p75s) continue;

      series.push({
        key: seriesKeyFor(scope.id, formFactor),
        label: `${scope.label} - ${formFactor.toLowerCase()}`,
        color: colorFor(scope.id, formFactor),
        values: new Map(source.periods.map((period, index) => [period, p75s[index] ?? null])),
      });
    }
  }

  return series;
}

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`;
    return path.length > 46 ? `${path.slice(0, 45)}\u2026` : path;
  } catch {
    return url;
  }
}
