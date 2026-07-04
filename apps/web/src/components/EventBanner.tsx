import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnimationsStore, type EventBannerCue, type EventToastCue } from '../store/animations';
import { useUi } from '../store/ui';
import { cityName, routeById } from '../game/content';
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

/** One self-expiring event toast (forecast announcement or a claim bonus). */
function EventToastRow({ cue }: { cue: EventToastCue }) {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const removeEventToast = useAnimationsStore((s) => s.removeEventToast);

  useEffect(() => {
    const id = window.setTimeout(() => removeEventToast(cue.id), 3400);
    return () => clearTimeout(id);
  }, [cue.id, removeEventToast]);

  const routeName = (id: string): string => {
    const r = routeById.get(id);
    return r ? `${cityName(r.a as string, locale)}–${cityName(r.b as string, locale)}` : id;
  };

  const text =
    cue.variant === 'announced'
      ? t('log.eventAnnounced', { event: t(eventNameKey(cue.kind)) })
      : t(`log.eventBonus.${cue.reason}`, {
          points: cue.points,
          city: cue.cityId ? cityName(cue.cityId, locale) : '',
          route: cue.routeId ? routeName(cue.routeId) : '',
        });

  return (
    <div className={`event-toast event-toast--${cue.variant}`} role="status">
      {text}
    </div>
  );
}

/** The stacked, self-expiring event toasts (announcements + bonuses), rendered above the board. */
export function EventToasts() {
  const toasts = useAnimationsStore((s) => s.eventToasts);
  if (toasts.length === 0) return null;
  return (
    <div className="event-toast-stack">
      {toasts.map((c) => (
        <EventToastRow key={c.id} cue={c} />
      ))}
    </div>
  );
}
