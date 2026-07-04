import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnimationsStore, type NotificationCue } from '../store/animations';
import { useUi } from '../store/ui';
import { cityName, routeById } from '../game/content';
import { eventNameKey } from '../game/events';

// Must stay >= the tr-toast-out duration in game.css so the exit animation finishes before the
// chip unmounts. Under prefers-reduced-motion the animation is disabled, so the chip simply
// lingers (invisible work, no flash) for this window then unmounts.
const EXIT_MS = 200;

// How long each variant stays fully visible before it starts fading out — matches the durations
// the two prior systems (Toast.tsx / the old EventToastRow) used, so timing doesn't regress.
const HOLD_MS: Record<NotificationCue['variant'], number> = {
  error: 3000,
  notice: 3500,
  success: 2000,
  announced: 3400,
  bonus: 3400,
};

function NotificationChip({ cue }: { cue: NotificationCue }) {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const removeNotification = useAnimationsStore((s) => s.removeNotification);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const holdId = window.setTimeout(() => setExiting(true), HOLD_MS[cue.variant]);
    return () => clearTimeout(holdId);
  }, [cue.variant]);

  useEffect(() => {
    if (!exiting) return;
    const exitId = window.setTimeout(() => removeNotification(cue.id), EXIT_MS);
    return () => clearTimeout(exitId);
  }, [exiting, cue.id, removeNotification]);

  const routeName = (id: string): string => {
    const r = routeById.get(id);
    return r ? `${cityName(r.a as string, locale)}–${cityName(r.b as string, locale)}` : id;
  };

  const text =
    cue.variant === 'announced'
      ? t('log.eventAnnounced', { event: t(eventNameKey(cue.kind)) })
      : cue.variant === 'bonus'
        ? t(`log.eventBonus.${cue.reason}`, {
            points: cue.points,
            city: cue.cityId ? cityName(cue.cityId, locale) : '',
            route: cue.routeId ? routeName(cue.routeId) : '',
          })
        : cue.text;

  const cls = [
    'notification-chip',
    `notification-chip--${cue.variant}`,
    exiting && 'notification-chip--exit',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} role="status">
      {text}
    </div>
  );
}

/** The stacked, self-expiring notification chips — system messages (errors, nudges, confirmations)
 *  and random-event announcements/bonuses — rendered above the board. */
export function NotificationStack() {
  const notifications = useAnimationsStore((s) => s.notifications);
  if (notifications.length === 0) return null;
  return (
    <div className="notification-stack">
      {notifications.map((c) => (
        <NotificationChip key={c.id} cue={c} />
      ))}
    </div>
  );
}
