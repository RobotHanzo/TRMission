import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, X } from 'lucide-react';
import type { RandomEventInfo } from '@trm/proto';
import { useGameStore } from '../store/game';
import { useUi } from '../store/ui';
import { usePlayerName } from '../game/playerName';
import { cityName } from '../game/content';
import { eventDescKey, eventNameKey, roundsLeft } from '../game/events';

/**
 * Compact side-rail card summarising the live random-events state. Renders ONLY when the snapshot
 * carries a `random_events` block (i.e. the mode is not "off"); everything shown is derived purely
 * from that authoritative projection — active effects, open charters, the one-round forecast, and
 * the gala free-station window. City names resolve by id through the active content catalog. Each
 * kind-bearing row carries an info button opening a modal with that event's full description.
 */
export function EventsPanel() {
  const { t } = useTranslation();
  const snapshot = useGameStore((s) => s.snapshot);
  const locale = useUi((s) => s.locale);
  const nameOf = usePlayerName();
  const [infoKind, setInfoKind] = useState<string | null>(null);

  useEffect(() => {
    if (!infoKind) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setInfoKind(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoKind]);

  const ev = snapshot?.randomEvents;
  if (!ev) return null;

  const me = snapshot?.you?.playerId ?? null;
  const seatOf = (id: string): number => snapshot?.players.find((p) => p.id === id)?.seat ?? 0;
  const forecast = ev.forecast;

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
              <button
                type="button"
                className="cell-view"
                aria-label={t('view')}
                title={t('view')}
                onClick={() => setInfoKind(info.kind)}
              >
                <Info size={13} aria-hidden />
              </button>
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
            <button
              type="button"
              className="cell-view"
              aria-label={t('view')}
              title={t('view')}
              onClick={() => setInfoKind('CHARTER_SPECIAL')}
            >
              <Info size={13} aria-hidden />
            </button>
          </div>
        ))}

        {forecast && (
          <div className="event-row event-forecast">
            <span className="event-label">{t('events.forecast')}</span>
            <span className="event-name">{t(eventNameKey(forecast.kind))}</span>
            <span className="event-note">{t('events.startsNextRound')}</span>
            <button
              type="button"
              className="cell-view"
              aria-label={t('view')}
              title={t('view')}
              onClick={() => setInfoKind(forecast.kind)}
            >
              <Info size={13} aria-hidden />
            </button>
          </div>
        )}
      </div>

      {infoKind && (
        <div className="modal-backdrop" onClick={() => setInfoKind(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h3>{t(eventNameKey(infoKind))}</h3>
              <button
                type="button"
                className="icon-button"
                aria-label={t('close')}
                onClick={() => setInfoKind(null)}
              >
                <X size={16} aria-hidden />
              </button>
            </div>
            <p>{t(eventDescKey(infoKind))}</p>
          </div>
        </div>
      )}
    </section>
  );
}
