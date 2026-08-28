import type { Point, Series } from '../types';
import { LAB_METRICS, INP_METRIC, formatValue, rate, type MetricDef } from '../metrics';

type Row = {
  key: string;
  label: string;
  color: string;
  series: Series;
};

type Props = {
  rows: Row[];
  /** The weeks currently in range, oldest first. */
  weeks: string[];
};

/** Latest week per series: value, week-over-week delta, and pass/fail. */
export function SummaryGrid({ rows, weeks }: Props) {
  const interactions = [...new Set(rows.flatMap((row) => Object.keys(row.series.inp)))].sort();

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
                <Cell key={def.key} def={def} points={row.series.metrics[def.key]} weeks={weeks} />
              ))}
              {interactions.map((name) => (
                <Cell key={name} def={INP_METRIC} points={row.series.inp[name]} weeks={weeks} />
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
  weeks,
}: {
  def: Pick<MetricDef, 'unit' | 'good' | 'poor' | 'higherIsBetter'>;
  points?: Point[];
  weeks: string[];
}) {
  const byWeek = new Map((points ?? []).map((point) => [point.week, point]));
  const latest = byWeek.get(weeks[weeks.length - 1] ?? '')?.median ?? null;
  const previous = byWeek.get(weeks[weeks.length - 2] ?? '')?.median ?? null;

  if (latest == null) return <td className="cell-empty">-</td>;

  const rating = rate(def, latest);
  const delta = previous == null ? null : latest - previous;
  // The arrow shows which way the number moved; the colour shows whether that
  // was an improvement, which is inverted for the performance score.
  const worse = delta == null ? false : def.higherIsBetter ? delta < 0 : delta > 0;

  return (
    <td className={`cell cell-${rating}`}>
      <span className="cell-value">{formatValue(def.unit, latest)}</span>
      {delta != null && delta !== 0 && (
        <span className={`cell-delta ${worse ? 'delta-worse' : 'delta-better'}`}>
          {delta > 0 ? '▲' : '▼'} {formatValue(def.unit, Math.abs(delta))}
        </span>
      )}
    </td>
  );
}
