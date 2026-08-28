import type { ContextPoint } from '../types';
import type { PeriodLabels } from '../dates';
import { CHART_LEFT_INSET, CHART_RIGHT_INSET } from './MetricChart';

type Props = {
  periods: string[];
  rows: { key: string; label: string; color: string; context: ContextPoint[] }[];
  labels: PeriodLabels;
};

/**
 * Per-run context under the charts.
 *
 * Without this, a content change is indistinguishable from a code regression: a
 * promo module appearing once moved mobile CLS on this site from 0.02 to 0.39,
 * and the search API's own variance drives most of LCP. Padded to the same
 * insets as the plot area so the cells line up with the periods above.
 */
export function ContextStrip({ periods, rows, labels }: Props) {
  // Only targets that actually record a search call or a card count. Including
  // the rest would fill the strip with dashes and bury the signal.
  const withContext = rows.filter((row) =>
    row.context.some((c) => c.searchApiMs != null || c.cards != null)
  );
  if (withContext.length === 0) return null;

  return (
    <div
      className="context-strip"
      style={{ paddingLeft: CHART_LEFT_INSET, paddingRight: CHART_RIGHT_INSET }}
    >
      {withContext.map((row) => {
        const byPeriod = new Map(row.context.map((point) => [point.period, point]));
        return (
          <div key={row.key} className="context-row">
            <span className="context-label">
              <span className="swatch" style={{ background: row.color }} />
              {row.label}
            </span>
            <div className="context-cells">
              {periods.map((period) => {
                const point = byPeriod.get(period);
                return (
                  <div key={period} className="context-cell" title={describe(labels.full(period), point)}>
                    <span className="context-api">
                      {point?.searchApiMs != null
                        ? `${(point.searchApiMs / 1000).toFixed(1)}s`
                        : '-'}
                    </span>
                    <span className="context-flags">
                      {point?.hasPromo && (
                        <span className="flag flag-promo" title="Promo module returned">
                          P
                        </span>
                      )}
                      {point?.errorCount ? (
                        <span className="flag flag-error" title={`${point.errorCount} failed sample(s)`}>
                          !
                        </span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="context-legend">
        Search API response time per run. <span className="flag flag-promo">P</span> a promo
        module was returned; <span className="flag flag-error">!</span> at least one sample
        failed.
      </p>
    </div>
  );
}

function describe(label: string, point?: ContextPoint): string {
  if (!point) return label;
  const parts = [label];
  if (point.searchApiMs != null) parts.push(`search API ${point.searchApiMs}ms`);
  if (point.cards != null) parts.push(`${point.cards} cards`);
  if (point.pageModules?.length) parts.push(`modules: ${point.pageModules.join(', ')}`);
  if (point.overlays?.length) parts.push(`overlays: ${point.overlays.join(', ')}`);
  parts.push(`${point.sampleCount} sample(s)`);
  return parts.join(' | ');
}
