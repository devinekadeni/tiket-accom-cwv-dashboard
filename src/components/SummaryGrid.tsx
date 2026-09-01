import type { Point, Series } from '../types';
import { LAB_METRICS, INP_METRIC, formatPercent, formatValue, rate, type MetricDef } from '../metrics';
import type { PeriodLabels } from '../dates';

type Row = {
  key: string;
  label: string;
  color: string;
  series: Series;
};

type Props = {
  rows: Row[];
  /** The periods currently in range, oldest first. */
  periods: string[];
  labels: PeriodLabels;
};

/** Latest run per series: value, delta against the previous run, and pass/fail. */
export function SummaryGrid({ rows, periods, labels }: Props) {
  const interactions = [...new Set(rows.flatMap((row) => Object.keys(row.series.inp)))].sort();
  const previous = periods[periods.length - 2] ?? null;

  return (
    <div className="summary-wrap">
      <table className="summary">
        <thead>
          <tr>
            <th scope="col">Target</th>
            {LAB_METRICS.map((def) => (
              <th key={def.key} scope="col" title={def.label}>
                {def.short}
              </th>
            ))}
            {interactions.map((name) => (
              <th key={name} scope="col" title={`INP - ${name}`}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">
                <span className="swatch" style={{ background: row.color }} />
                {row.label}
              </th>
              {LAB_METRICS.map((def) => (
                <Cell
                  key={def.key}
                  def={def}
                  points={row.series.metrics[def.key]}
                  periods={periods}
                  previousLabel={previous ? labels.full(previous) : null}
                />
              ))}
              {interactions.map((name) => (
                <Cell
                  key={name}
                  def={INP_METRIC}
                  points={row.series.inp[name]}
                  periods={periods}
                  previousLabel={previous ? labels.full(previous) : null}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({
  def,
  points,
  periods,
  previousLabel,
}: {
  def: Pick<MetricDef, 'unit' | 'good' | 'poor' | 'higherIsBetter'>;
  points?: Point[];
  periods: string[];
  previousLabel: string | null;
}) {
  const byPeriod = new Map((points ?? []).map((point) => [point.period, point]));
  const latest = byPeriod.get(periods[periods.length - 1] ?? '')?.median ?? null;
  const previous = byPeriod.get(periods[periods.length - 2] ?? '')?.median ?? null;

  if (latest == null) return <td className="cell-empty">-</td>;

  const rating = rate(def, latest);

  if (previous == null || latest === previous) {
    return (
      <td className={`cell cell-${rating}`}>
        <span className="cell-value">{formatValue(def.unit, latest)}</span>
        {previous != null && <span className="cell-delta delta-flat">no change</span>}
      </td>
    );
  }

  const delta = latest - previous;

  // The arrow follows the number, so it points up whenever the value rose. The
  // colour carries the judgement, because up is an improvement for the score and
  // a regression for everything else.
  const rose = delta > 0;
  const better = def.higherIsBetter ? rose : !rose;
  const magnitude = formatValue(def.unit, Math.abs(delta));
  const percent = formatPercent(delta, previous);
  const change = percent ? `${magnitude} (${percent})` : magnitude;

  return (
    <td className={`cell cell-${rating}`}>
      <span className="cell-value">{formatValue(def.unit, latest)}</span>
      <span
        className={`cell-delta ${better ? 'delta-better' : 'delta-worse'}`}
        title={`${change} ${better ? 'better' : 'worse'}${
          previousLabel ? ` than ${previousLabel}` : ''
        }`}
      >
        <span aria-hidden="true">{rose ? '\u25B2' : '\u25BC'}</span> {magnitude}
        {percent && <span className="cell-percent"> ({percent})</span>}
        <span className="visually-hidden"> {better ? 'better' : 'worse'}</span>
      </span>
    </td>
  );
}
