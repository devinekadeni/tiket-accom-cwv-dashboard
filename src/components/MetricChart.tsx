import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ResponsiveContainer,
} from 'recharts';

import type { Point } from '../types';
import type { PeriodLabels } from '../dates';
import { formatValue, rate, type MetricDef } from '../metrics';
import { AXIS_WIDTH, ThresholdTick, buildTicks, thresholdsCrowded } from './ThresholdAxis';

export type ChartSeries = {
  key: string;
  label: string;
  color: string;
  points: Point[];
};

type Props = {
  def: Pick<MetricDef, 'label' | 'unit' | 'good' | 'poor' | 'higherIsBetter' | 'note'>;
  periods: string[];
  series: ChartSeries[];
  labels: PeriodLabels;
};

/** Left inset of the plot area, shared with the context strip so they line up. */
export const CHART_LEFT_INSET = AXIS_WIDTH + 8;
export const CHART_RIGHT_INSET = 16;

export function MetricChart({ def, periods, series, labels }: Props) {
  // Keyed by period rather than positional, so a filtered period list cannot
  // silently shift a series against the axis.
  const byPeriod = new Map(
    series.map((s) => [s.key, new Map(s.points.map((point) => [point.period, point]))])
  );

  const rows = periods.map((period) => {
    const row: Record<string, unknown> = { period };
    for (const s of series) {
      const point = byPeriod.get(s.key)?.get(period);
      row[s.key] = point?.median ?? null;
      // Recharts draws a band when the value is a [low, high] pair. This is the
      // spread across the period's samples, not a confidence interval - LCP here
      // inherits the search API's variance, and a bare median would imply a
      // precision the measurement does not have.
      row[`${s.key}__range`] =
        point?.min != null && point?.max != null ? [point.min, point.max] : null;
    }
    return row;
  });

  const visibleWeeks = new Set(periods);
  const values = series.flatMap((s) =>
    s.points
      .filter((p) => visibleWeeks.has(p.period))
      .flatMap((p) => [p?.median, p?.min, p?.max].filter((v): v is number => v != null))
  );
  const dataMax = values.length > 0 ? Math.max(...values) : def.poor;
  const upper = Math.max(dataMax * 1.1, def.poor * 1.2);

  return (
    <figure className="chart">
      <figcaption>
        <h3>{def.label}</h3>
        {def.note && <p className="chart-note">{def.note}</p>}
      </figcaption>

      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart
          data={rows}
          margin={{ top: 8, right: CHART_RIGHT_INSET, bottom: 4, left: 8 }}
        >
          {/* Google's thresholds as bands, so a series is read against the bar
              it has to clear rather than against its own history alone. */}
          {def.higherIsBetter ? (
            <>
              <ReferenceArea y1={def.good} y2={upper} fill="#16a34a" fillOpacity={0.06} />
              <ReferenceArea y1={def.poor} y2={def.good} fill="#f59e0b" fillOpacity={0.06} />
              <ReferenceArea y1={0} y2={def.poor} fill="#dc2626" fillOpacity={0.06} />
            </>
          ) : (
            <>
              <ReferenceArea y1={0} y2={def.good} fill="#16a34a" fillOpacity={0.06} />
              <ReferenceArea y1={def.good} y2={def.poor} fill="#f59e0b" fillOpacity={0.06} />
              <ReferenceArea y1={def.poor} y2={upper} fill="#dc2626" fillOpacity={0.06} />
            </>
          )}

          <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="period"
            tick={{ fontSize: 11 }}
            tickMargin={8}
            minTickGap={16}
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
                  <strong>{labels.full(String(label))}</strong>
                  {series.map((s) => {
                    const row = rows.find((r) => r.period === label);
                    const median = row?.[s.key] as number | null | undefined;
                    const range = row?.[`${s.key}__range`] as [number, number] | null;
                    if (median == null) return null;
                    return (
                      <div key={s.key} className="tooltip-row">
                        <span className="swatch" style={{ background: s.color }} />
                        <span className="tooltip-label">{s.label}</span>
                        <span className="tooltip-value">
                          {formatValue(def.unit, median)}
                          {range && range[0] !== range[1] && (
                            <em>
                              {' '}
                              ({formatValue(def.unit, range[0])}-{formatValue(def.unit, range[1])})
                            </em>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : null
            }
          />

          {series.map((s) => (
            <Area
              key={`${s.key}-range`}
              type="monotone"
              dataKey={`${s.key}__range`}
              stroke="none"
              fill={s.color}
              fillOpacity={0.14}
              isAnimationActive={false}
              connectNulls={false}
              activeDot={false}
            />
          ))}
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={{ r: 3 }}
              isAnimationActive={false}
              connectNulls={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>

      <LatestReadout def={def} series={series} />
    </figure>
  );
}

/** The current value per series, rated against the threshold. */
function LatestReadout({ def, series }: Pick<Props, 'def' | 'series'>) {
  return (
    <div className="readout">
      {series.map((s) => {
        const latest = [...s.points].reverse().find((p) => p?.median != null);
        if (!latest?.median) return null;
        return (
          <span key={s.key} className={`pill pill-${rate(def, latest.median)}`}>
            <span className="swatch" style={{ background: s.color }} />
            {s.label}: {formatValue(def.unit, latest.median)}
          </span>
        );
      })}
    </div>
  );
}
