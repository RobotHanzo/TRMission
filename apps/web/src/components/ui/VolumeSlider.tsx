import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { Slider } from './Slider';

interface Props {
  value: number;
  enabled: boolean;
  onChangeValue(next: number): void;
  onToggleEnabled(next: boolean): void;
  rangeLabel: string;
  muteLabel: string;
}

export function VolumeSlider({
  value,
  enabled,
  onChangeValue,
  onToggleEnabled,
  rangeLabel,
  muteLabel,
}: Props) {
  const Icon = !enabled || value === 0 ? VolumeX : value <= 0.5 ? Volume1 : Volume2;
  return (
    <div className="volume-slider">
      <button
        type="button"
        className="volume-icon-btn"
        aria-pressed={enabled}
        aria-label={muteLabel}
        onClick={() => onToggleEnabled(!enabled)}
      >
        <Icon size={18} aria-hidden />
      </button>
      <Slider value={value} onChange={onChangeValue} ariaLabel={rangeLabel} disabled={!enabled} />
    </div>
  );
}
