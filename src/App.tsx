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

  const allPeriods = useMemo(() => history.runs.map((w) => w.period), []);
  const periods = useMemo(() => filterPeriods(allPeriods, range), [allPeriods, range]);
  // Built over every period, not the filtered ones, so the masthead can still
  // name the latest run when the current filter excludes it.
  const labels = useMemo(() => buildPeriodLabels(allPeriods), [allPeriods]);

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
  const latest = history.runs.at(-1);

  const rangeSummary =
    tab === 'lab'
      ? `${periods.length} of ${allPeriods.length} scans`
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
            Lighthouse scan of three production hotel pages after each deploy day, median of{' '}
            {latest?.samples ?? 5} samples.{' '}
            {latest && (
              <>
                Latest run{' '}
                <strong>{labels.full(latest.period)}</strong> with Lighthouse{' '}
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
        bounds={dataBounds(tab === 'lab' ? allPeriods : cruxPeriods)}
      />

      {tab === 'lab' ? (
        allPeriods.length === 0 ? (
          <p className="empty">
            No runs yet. Trigger the <code>cwv-scan</code> workflow to record the first one.
          </p>
        ) : (
          <LabTab
            periods={periods}
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
          run-to-run trend is the meaningful part, since the vantage point is constant.
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
  periods: string[];
  labels: PeriodLabels;
  rows: SeriesRow[];
  groups: TargetGroup[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
  samples: number;
};

function LabTab({ periods, labels, rows, groups, hidden, onToggle, samples }: LabProps) {
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
          Twice a week - early on Tuesday and Friday mornings, after each of the team's two
          deploy days - a GitHub Actions runner asks Google's PageSpeed Insights API to run
          Lighthouse against the three production URLs above, at its <strong>mobile</strong>{' '}
          preset (throttled phone on slow 4G) and its <strong>desktop</strong> one. Each page
          is measured <strong>{samples} times</strong> per form factor; the line is the median
          and the shaded band is the spread from fastest to slowest, so a wide band means the
          page itself is inconsistent rather than the measurement being wrong. The bands here
          are wide.
        </p>
        <p>
          The scan does not drive a browser of its own. It used to, which is the more capable
          approach - it can script a real press and so measure INP, and it can watch the page's
          own network traffic for context like how long the search API took. But the site is
          behind bot protection that intermittently serves an automated browser a challenge
          screen instead of the page, and that screen measures as a very fast page rather than
          as a failure. An entire run was published as roughly 400ms LCP across three
          different pages before it was caught. Measuring from infrastructure the site admits
          is worth losing INP for; the scan now also refuses outright to record anything that
          looks like a challenge screen.
        </p>
        <p className="muted">
          This is lab data: Lighthouse run by Google's PageSpeed Insights against the live
          pages, five samples each, plotted as the median with the spread behind it. One
          scripted path, one vantage point, repeatable on purpose - it catches regressions
          early and tells you which page moved, but it is not what your users experienced.
          The field tab is. The spread is worth reading: repeat runs of the same page minutes
          apart have differed by several seconds, so treat a single run's move with caution.
          All three URLs are the Indonesian (<code>/id-id/</code>) pages, which carry the bulk
          of real traffic; the English equivalents behave differently and appear in the field
          tab for comparison.
        </p>
      </div>

      {periods.length === 0 ? (
        <p className="empty">No scans in the selected range. Widen the date filter.</p>
      ) : (
        <>
          <h2>Latest run</h2>
          <p className="muted">
            Value, change from the previous run, and rating against Google's thresholds. Runs
            sit either side of a deploy window, so a change here contains one deploy.
          </p>
          <SummaryGrid rows={rows} periods={periods} />

          <h2>Interactions</h2>
          {interactions.length === 0 ? (
            <p className="muted">
              Not measured here. INP needs a real press on a real control, and PageSpeed
              Insights only loads a page - it cannot open the filter sheet or the room list.
              Driving a browser ourselves can, but the site's bot protection refuses an
              automated browser often enough that the measurement could not be relied on. Use
              the field tab, where INP is the p75 of what users actually did.
            </p>
          ) : (
            <>
              <p className="muted">
                Measured in Lighthouse timespan mode with the CPU throttled 4x - a scripted
                press on one path, not the p75 of everything real users do. The field tab
                settles that.
              </p>
              <div className="charts">
                {interactions.map((name) => (
                  <div key={name} className="chart-block">
                    <MetricChart
                      def={{ ...INP_METRIC, label: `INP - ${name}` }}
                      periods={periods}
                      labels={labels}
                      series={toChartSeries(rows, periods, (series) => series.inp[name])}
                    />
                  </div>
                ))}
              </div>
            </>
          )}

          <h2>Page load</h2>
          <div className="charts">
            {LAB_METRICS.map((def) => (
              <div key={def.key} className="chart-block">
                <MetricChart
                  def={def}
                  periods={periods}
                  labels={labels}
                  series={toChartSeries(rows, periods, (series) => series.metrics[def.key])}
                />
                <ContextStrip periods={periods} rows={contextRows} labels={labels} />
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
  periods: string[],
  pick: (series: Series) => Series['metrics'][keyof Series['metrics']] | undefined
): ChartSeries[] {
  const inRange = new Set(periods);
  return rows
    .map((row) => ({
      key: row.key,
      label: row.label,
      color: row.color,
      points: (pick(row.series) ?? []).filter((point) => inRange.has(point.period)),
    }))
    .filter((s) => s.points.some((p) => p?.median != null));
}
