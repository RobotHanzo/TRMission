import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { type EventBannerCue } from '../store/animations';
import { eventDescKey, eventNameKey } from '../game/events';

interface Props {
  cue: EventBannerCue;
  reducedMotion: boolean;
  onDone(): void;
}

/**
 * The random-event START banner: a prominent but skippable card announcing a newly-live event.
 * Modelled on {@link EndgameWarning} — dismissible by click / Escape / auto-timeout and
 * reduced-motion aware. All copy resolves from the event `kind` at render.
 */
export function EventBanner({ cue, reducedMotion, onDone }: Props) {
  const { t } = useTranslation();

  const done = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onDoneRef.current();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    const timer = window.setTimeout(finish, reducedMotion ? 1800 : 3400);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(timer);
    };
  }, [reducedMotion, finish]);

  return (
    <div className="event-backdrop" onClick={finish}>
      <div className="event-banner-panel" role="alert">
        <div className="event-eyebrow">{t('events.eyebrow')}</div>
        <div className="event-banner-title">{t(eventNameKey(cue.kind))}</div>
        <div className="event-banner-desc">{t(eventDescKey(cue.kind))}</div>
        <div className="event-skip">{t('skip')}</div>
      </div>
    </div>
  );
}
