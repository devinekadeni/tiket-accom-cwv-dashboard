import { RANGE_PRESETS, type DateRange, type RangePreset } from '../dates';

type Props = {
  value: DateRange;
  onChange: (range: DateRange) => void;
  /** Shown alongside the control so an empty chart is explicable. */
  summary: string;
  /** Extent of the data, used to prefill custom rather than opening blank. */
  bounds: { from: string; to: string };
};

export function RangeFilter({ value, onChange, summary, bounds }: Props) {
  function selectPreset(preset: RangePreset) {
    if (preset === 'custom' && !value.from && !value.to) {
      onChange({ preset, from: bounds.from, to: bounds.to });
      return;
    }
    onChange({ ...value, preset });
  }

  return (
    <div className="range-filter">
      <span className="range-label">Show</span>
      <div className="range-presets">
        {RANGE_PRESETS.map((preset) => (
          <button
            key={preset.value}
            className={value.preset === preset.value ? 'toggle toggle-on' : 'toggle'}
            onClick={() => selectPreset(preset.value)}
            aria-pressed={value.preset === preset.value}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {value.preset === 'custom' && (
        <div className="range-custom">
          <label>
            <span className="muted">From</span>
            <input
              type="date"
              value={value.from}
              max={value.to || undefined}
              onChange={(event) => onChange({ ...value, from: event.target.value })}
            />
          </label>
          <label>
            <span className="muted">To</span>
            <input
              type="date"
              value={value.to}
              min={value.from || undefined}
              onChange={(event) => onChange({ ...value, to: event.target.value })}
            />
          </label>
        </div>
      )}

      <span className="range-summary muted">{summary}</span>
    </div>
  );
}
