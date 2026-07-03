import { useTranslation } from 'react-i18next';

export type SignalAspect = 'clear' | 'caution' | 'stop' | 'neutral';

/**
 * Railway signal-aspect status badge. The dot is never alone — a text label always
 * rides along (colour-blind safe, matching the game's accessibility care).
 */
export function SignalBadge({ aspect, label }: { aspect: SignalAspect; label?: string }) {
  const { t } = useTranslation();
  const text = label ?? (aspect === 'neutral' ? '—' : t(`signal.${aspect}`));
  return (
    <span className={`oc-signal ${aspect}`}>
      <span className="dot" aria-hidden />
      {text}
    </span>
  );
}

/** Map common entity statuses onto signal aspects. */
export const aspectForStatus = (status: string): SignalAspect => {
  switch (status) {
    case 'LIVE':
    case 'STARTED':
    case 'active':
      return 'clear';
    case 'LOBBY':
      return 'caution';
    case 'CLOSED':
    case 'TERMINATED':
    case 'disabled':
      return 'stop';
    default:
      return 'neutral';
  }
};
