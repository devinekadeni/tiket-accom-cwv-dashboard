import { useMemo, useState } from 'react';

import historyJson from './generated/history.json';
import type { History, Series } from './types';
import {
  DEFAULT_RANGE,
  buildPeriodLabels,
  filterPeriods,
  parsePeriod,
  toDateInput,
  type DateRange,
  type PeriodLabels,
} from './dates';
import { useTheme } from './theme';
import {
  LAB_METRICS,
  INP_METRIC,
  formFactorLabel,
  seriesColor,
  seriesKey,
  seriesLabel,
} from './metrics';
import { MetricChart, type ChartSeries } from './components/MetricChart';
import { ContextStrip } from './components/ContextStrip';
import { SummaryGrid } from './components/SummaryGrid';
import { FieldTab } from './components/FieldTab';
import { RangeFilter } from './components/RangeFilter';

const history = historyJson as unknown as History;

export default function App() {
  const [tab, setTab] = useState<'lab' | 'field'>('lab');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<DateRange>(DEFAULT_RANGE);
  const [theme, toggleTheme] = useTheme();

  const targets = useMemo(
    () => new Map(history.targets.map((target) => [target.id, target])),
    []
  );

  const decorated = useMemo(
    () =>
      history.series.map((series) => ({
        key: seriesKey(series),
        label: seriesLabel(series, Object.fromEntries([...targets].map(([id, t]) => [id, t.label]))),
        color: seriesColor(series.targetId, series.formFactor),
        series,
      })),
    [targets]
  );

  /** One toggle group per page, so the chips only have to name the form factor. */
  const groups = useMemo(() => {
    const byTarget = new Map<string, TargetGroup>();
    for (const row of decorated) {
      const { targetId } = row.series;
      let group = byTarget.get(targetId);
      if (!group) {
        group = {
          id: targetId,
          label: targets.get(targetId)?.label ?? targetId,
          url: targets.get(targetId)?.url ?? '',
          rows: [],
        };
        byTarget.set(targetId, group);
      }
      group.rows.push(row);
    }
    for (const group of byTarget.values()) {
      group.rows.sort((a, b) => a.series.formFactor.localeCompare(b.series.formFactor));
    }
    return [...byTarget.values()];
  }, [decorated, targets]);

  const allWeeks = useMemo(() => history.weeks.map((w) => w.week), []);
  const weeks = useMemo(() => filterPeriods(allWeeks, range), [allWeeks, range]);
  const labels = useMemo(() => buildPeriodLabels(weeks), [weeks]);

  const cruxPeriods = useMemo(
    () =>
      history.crux
        ? [
            ...new Set(
              history.crux.scopes.flatMap((scope) =>
                Object.values(scope.formFactors).flatMap((series) => series.periods)
              )
            ),
          ].sort()
        : [],
    []
  );

  const visible = decorated.filter((row) => !hidden.has(row.key));
  const latest = history.weeks.at(-1);

  const rangeSummary =
    tab === 'lab'
      ? `${weeks.length} of ${allWeeks.length} weekly scans`
      : `${filterPeriods(cruxPeriods, range).length} of ${cruxPeriods.length} windows`;

  function toggle(key: string) {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="app">
      <header className="masthead">
        <div>
          <h1>tiket.com accommodation - Core Web Vitals</h1>
          <p className="muted">
            Weekly Lighthouse scan of three production hotel pages, median of{' '}
            {latest?.samples ?? 5} samples.{' '}
            {latest && (
              <>
                Latest run <strong>{latest.week}</strong> on{' '}
                {new Date(latest.runAt).toLocaleDateString()} with Lighthouse{' '}
                {latest.lighthouseVersion}.
              </>
            )}
          </p>
        </div>
        <div className="masthead-controls">
          <button
            className="tab theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? '\u2600' : '\u263D'}
            <span className="theme-toggle-text">{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
          <nav className="tabs">
            <button
              className={tab === 'lab' ? 'tab tab-active' : 'tab'}
              onClick={() => setTab('lab')}
            >
              Lab
            </button>
            <button
              className={tab === 'field' ? 'tab tab-active' : 'tab'}
              onClick={() => setTab('field')}
            >
              Field (CrUX)
            </button>
          </nav>
        </div>
      </header>

      <RangeFilter
        value={range}
        onChange={setRange}
        summary={rangeSummary}
        bounds={dataBounds(tab === 'lab' ? allWeeks : cruxPeriods)}
      />

      {tab === 'lab' ? (
        allWeeks.length === 0 ? (
          <p className="empty">
            No runs yet. Trigger the <code>weekly-cwv</code> workflow to record the first week.
          </p>
        ) : (
          <LabTab
            weeks={weeks}
            labels={labels}
            rows={visible}
            groups={groups}
            hidden={hidden}
            onToggle={toggle}
            samples={latest?.samples ?? 5}
          />
        )
      ) : (
        <FieldTab crux={history.crux} range={range} />
      )}

      <footer className="footer">
        <p>
          Measured from a GitHub Actions runner in the US/Europe against an origin served from
          South-East Asia, so absolute values read higher than they would locally. The
          week-over-week trend is the meaningful part, since the vantage point is constant.
        </p>
        <p className="muted">Generated {new Date(history.generatedAt).toLocaleString()}.</p>
      </footer>
    </div>
  );
}

/** First and last date in the data, used to prefill the custom range inputs. */
function dataBounds(ids: string[]): { from: string; to: string } {
  const dates = ids.map(parsePeriod).filter((d): d is Date => d != null);
  if (dates.length === 0) return { from: '', to: '' };
  return { from: toDateInput(dates[0]), to: toDateInput(dates[dates.length - 1]) };
}

type SeriesRow = { key: string; label: string; color: string; series: Series };

type TargetGroup = { id: string; label: string; url: string; rows: SeriesRow[] };

type LabProps = {
  weeks: string[];
  labels: PeriodLabels;
  rows: SeriesRow[];
  groups: TargetGroup[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
  samples: number;
};

function LabTab({ weeks, labels, rows, groups, hidden, onToggle, samples }: LabProps) {
  const interactions = [...new Set(rows.flatMap((row) => Object.keys(row.series.inp)))].sort();

  const contextRows = rows.map((row) => ({
    key: row.key,
    label: row.label,
    color: row.color,
    context: row.series.context,
  }));

  return (
    <section>
      <div className="toggle-groups">
        {groups.map((group) => (
          <div key={group.id} className="toggle-group">
            <span className="toggle-group-label">
              <span className="toggle-group-name">{group.label}</span>
              {group.url && (
                <a
                  className="toggle-group-url"
                  href={group.url}
                  target="_blank"
                  rel="noreferrer"
                  title={group.url}
                >
                  {shortUrl(group.url)}
                </a>
              )}
            </span>
            <div className="toggle-group-chips">
              {group.rows.map((row) => (
                <button
                  key={row.key}
                  className={hidden.has(row.key) ? 'toggle toggle-off' : 'toggle'}
                  onClick={() => onToggle(row.key)}
                  aria-pressed={!hidden.has(row.key)}
                  aria-label={row.label}
                >
                  <span className="swatch" style={{ background: row.color }} />
                  {formFactorLabel(row.series.formFactor)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="callout">
        <h2>How this data is collected</h2>
        <p>
          Once a week a GitHub Actions runner drives a real headless Chrome through Lighthouse
          against the three production URLs above, at a <strong>mobile</strong> preset
          (390x844, slow 4G, 4x CPU slowdown) and a <strong>desktop</strong> one (1440x900,
          dense 4G, no slowdown). Each page is loaded <strong>{samples} times</strong> per form
          factor; the line is the median of those samples and the shaded band is the spread
          from the fastest to the slowest, so a wide band means the page itself is
          inconsistent rather than the measurement being wrong.
        </p>
        <p>
          Page-load metrics come from Lighthouse navigation mode with simulated throttling, the
          lowest-variance option and the reason a weekly line is signal rather than noise. INP
          is different: it needs real event timings, so it is measured in timespan mode around
          one scripted interaction per page - opening the destination autocomplete, the filter
          sheet, the sort sheet, or a room list - with the CPU genuinely throttled 4x.
        </p>
        <p className="muted">
          This is lab data: one scripted path, one vantage point, repeatable on purpose. It
          catches regressions early and tells you which page and which interaction moved, but
          it is not what your users experienced - the field tab is. Run context under each
          chart records what the page actually returned that week, since a promo module
          appearing can move CLS more than any code change. All three URLs are the Indonesian
          (<code>/id-id/</code>) pages, which carry the bulk of real traffic; the English
          equivalents behave differently and appear in the field tab for comparison.
        </p>
      </div>

      {weeks.length === 0 ? (
        <p className="empty">No scans in the selected range. Widen the date filter.</p>
      ) : (
        <>
          <h2>Latest week</h2>
          <p className="muted">
            Value, change from the previous week, and rating against Google's thresholds.
          </p>
          <SummaryGrid rows={rows} weeks={weeks} />

          <h2>Interactions</h2>
          <p className="muted">
            Measured in Lighthouse timespan mode with the CPU throttled 4x - a scripted press on
            one path, not the p75 of everything real users do. The field tab settles that.
          </p>
          <div className="charts">
            {interactions.map((name) => (
              <div key={name} className="chart-block">
                <MetricChart
                  def={{ ...INP_METRIC, label: `INP - ${name}` }}
                  weeks={weeks}
                  labels={labels}
                  series={toChartSeries(rows, weeks, (series) => series.inp[name])}
                />
              </div>
            ))}
          </div>

          <h2>Page load</h2>
          <div className="charts">
            {LAB_METRICS.map((def) => (
              <div key={def.key} className="chart-block">
                <MetricChart
                  def={def}
                  weeks={weeks}
                  labels={labels}
                  series={toChartSeries(rows, weeks, (series) => series.metrics[def.key])}
                />
                <ContextStrip weeks={weeks} rows={contextRows} labels={labels} />
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/** Path and query only - the origin is the same for every target. */
function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`;
    return path.length > 46 ? `${path.slice(0, 45)}\u2026` : path;
  } catch {
    return url;
  }
}

function toChartSeries(
  rows: LabProps['rows'],
  weeks: string[],
  pick: (series: Series) => Series['metrics'][keyof Series['metrics']] | undefined
): ChartSeries[] {
  const inRange = new Set(weeks);
  return rows
    .map((row) => ({
      key: row.key,
      label: row.label,
      color: row.color,
      points: (pick(row.series) ?? []).filter((point) => inRange.has(point.week)),
    }))
    .filter((s) => s.points.some((p) => p?.median != null));
}
