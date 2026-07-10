import { type CSSProperties } from 'react';

interface Props {
  value: number;
  onChange(next: number): void;
  ariaLabel: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}

/** The restyled native `<input type="range">` shared by the settings volume control and the
 *  map builder's ticket-view zoom level — same fill-track look wherever a 0..1 (or custom-range)
 *  slider is needed. */
export function Slider({ value, onChange, ariaLabel, min = 0, max = 1, step = 0.05, disabled }: Props) {
  const fill = (value - min) / (max - min);
  return (
    <input
      type="range"
      className="slider-range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{ '--tr-range-fill': fill } as CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}
