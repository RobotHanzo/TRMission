import { useTranslation } from 'react-i18next';
import type { RandomEventInfo } from '@trm/proto';
import { useGameStore } from '../store/game';
import { useUi } from '../store/ui';
import { usePlayerName } from '../game/playerName';
import { cityName } from '../game/content';
import { eventNameKey, roundsLeft } from '../game/events';

/**
 * Compact side-rail card summarising the live random-events state. Renders ONLY when the snapshot
 * carries a `random_events` block (i.e. the mode is not "off"); everything shown is derived purely
 * from that authoritative projection — active effects, open charters, the one-round forecast, and
 * the gala free-station window. City names resolve by id through the active content catalog.
 */
export function EventsPanel() {
  const { t } = useTranslation();
  const snapshot = useGameStore((s) => s.snapshot);
  const locale = useUi((s) => s.locale);
  const nameOf = usePlayerName();

  const ev = snapshot?.randomEvents;
  if (!ev) return null;

  const me = snapshot?.you?.playerId ?? null;
  const seatOf = (id: string): number => snapshot?.players.find((p) => p.id === id)?.seat ?? 0;

  // The affected-target summary for one active entry: a city (hotspot) or a route count (typhoon /
  // sky-lantern), resolved by id — never a hardcoded name.
  const affected = (info: RandomEventInfo): string | null => {
    if (info.kind === 'VIRAL_HOTSPOT' && info.cityId) return cityName(info.cityId, locale);
    if (info.routeIds.length > 0) return t('events.affectedRoutes', { n: info.routeIds.length });
    return null;
  };

  return (
    <section className="events-panel tray-section" data-testid="events-panel">
      <div className="tray-head">
        <h4>{t('events.panelTitle')}</h4>
        <span className="events-chip">{t(`eventsMode_${ev.mode}`)}</span>
      </div>
      <div className="events-body">
        {ev.freeStationAvailable && (
          <div className="event-row event-free">{t('events.freeStation')}</div>
        )}

        {ev.active.map((info) => {
          const left = roundsLeft(info, ev.roundIndex);
          const summary = affected(info);
          return (
            <div key={info.id} className="event-row event-active">
              <span className="event-name">{t(eventNameKey(info.kind))}</span>
              {summary && <span className="event-summary">{summary}</span>}
              {left !== null && (
                <span className="event-rounds">{t('events.roundsLeft', { n: left })}</span>
              )}
            </div>
          );
        })}

        {ev.charters.map((c) => (
          <div key={c.id} className="event-row event-charter">
            <span className="event-name">
              {t('events.charterOpen', {
                a: cityName(c.cityA, locale),
                b: cityName(c.cityB, locale),
                pts: c.points,
              })}
            </span>
            {c.wonByPlayerId !== '' && (
              <span className="event-won">
                {t('events.charterWon', {
                  name: nameOf({
                    id: c.wonByPlayerId,
                    seat: seatOf(c.wonByPlayerId),
                    isMe: c.wonByPlayerId === me,
                  }),
                })}
              </span>
            )}
          </div>
        ))}

        {ev.forecast && (
          <div className="event-row event-forecast">
            <span className="event-label">{t('events.forecast')}</span>
            <span className="event-name">{t(eventNameKey(ev.forecast.kind))}</span>
            <span className="event-note">{t('events.startsNextRound')}</span>
          </div>
        )}
      </div>
    </section>
  );
}
