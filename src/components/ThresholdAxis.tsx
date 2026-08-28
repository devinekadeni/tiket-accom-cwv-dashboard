import { formatValue, type MetricDef } from '../metrics';

/** Width the y-axis needs to fit a label plus its threshold marker. */
export const AXIS_WIDTH = 74;

const EPSILON = 1e-9;
const near = (a: number, b: number) => Math.abs(a - b) < EPSILON;

/**
 * Axis ticks that always include the two thresholds, so the boundary a series
 * has to clear is readable as a number rather than only inferable from where
 * the background band changes colour.
 *
 * Regular ticks are placed on round numbers and any that would collide with a
 * threshold are dropped, since the threshold is the more useful label.
 */
export function buildTicks(upper: number, good: number, poor: number): number[] {
  const thresholds = [good, poor].filter((t) => t > 0 && t < upper);
  const step = niceStep(upper / 4);

  const regular: number[] = [];
  for (let value = 0; value <= upper + EPSILON; value += step) {
    regular.push(Number(value.toFixed(6)));
  }

  const minGap = upper * 0.09;
  const kept = regular.filter((value) =>
    thresholds.every((threshold) => Math.abs(value - threshold) > minGap)
  );

  return [...new Set([...kept, ...thresholds])].sort((a, b) => a - b);
}

/**
 * True when the two thresholds sit close enough that their labels would
 * overlap. Happens on axes stretched by one bad series - LCP's 2.5s and 4s are
 * ~10px apart once the SRP pushes the scale past 30s.
 */
export function thresholdsCrowded(upper: number, good: number, poor: number): boolean {
  return (Math.abs(poor - good) / upper) * PLOT_HEIGHT < 14;
}

/** Approximate drawable height of a chart, used only for collision estimates. */
const PLOT_HEIGHT = 218;

/** Round a raw step up to the nearest 1, 2, 2.5 or 5 times a power of ten. */
function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const fraction = raw / magnitude;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * magnitude;
}

type TickProps = {
  x?: number;
  y?: number;
  payload?: { value: number };
  unit: MetricDef['unit'];
  good: number;
  poor: number;
  crowded?: boolean;
};

/** Recharts clones this with x, y and payload. */
export function ThresholdTick({ x = 0, y = 0, payload, unit, good, poor, crowded }: TickProps) {
  const value = payload?.value ?? 0;
  const isGood = near(value, good);
  const isPoor = near(value, poor);
  const variant = isGood ? 'good' : isPoor ? 'poor' : null;

  // The marker stays on the true value; only the text slides so both stay legible.
  // Only the upper label moves, to avoid pushing the lower one into the baseline.
  const nudge = crowded && isPoor ? -6 : 0;

  return (
    <g transform={`translate(${x},${y})`}>
      {variant && (
        <rect x={-9} y={-3.5} width={7} height={7} rx={1.5} className={`axis-marker-${variant}`} />
      )}
      <text
        x={-13}
        dy={4 + nudge}
        textAnchor="end"
        fontSize={11}
        className={variant ? `axis-tick axis-tick-${variant}` : 'axis-tick'}
      >
        {formatValue(unit, value)}
      </text>
    </g>
  );
}
