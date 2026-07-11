import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, X } from 'lucide-react';
import type { RandomEventInfo } from '@trm/proto';
import { useGameStore } from '../store/game';
import { useUi } from '../store/ui';
import { useAnimationsStore } from '../store/animations';
import { usePlayerName } from '../game/playerName';
import { cityName, routeById } from '../game/content';
import { ownershipMap } from '../game/view';
import { eventDescKey, eventNameKey, roundsLeft } from '../game/events';

/**
 * Compact side-rail card summarising the live random-events state. Renders ONLY when the snapshot
 * carries a `random_events` block (i.e. the mode is not "off"); everything shown is derived purely
 * from that authoritative projection — active effects, open charters, the one-round forecast, and
 * the gala free-station window. City names resolve by id through the active content catalog. Each
 * kind-bearing row carries an info button opening a modal with that event's full description; for a
 * route-targeting kind (Sky Lantern, Typhoon Landfall) the modal also lists the currently-unclaimed
 * affected routes, each clickable to pan the board's camera straight to it.
 */
export function EventsPanel() {
  const { t } = useTranslation();
  const snapshot = useGameStore((s) => s.snapshot);
  const locale = useUi((s) => s.locale);
  const nameOf = usePlayerName();
  const setEventSpotlight = useAnimationsStore((s) => s.setEventSpotlight);
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
  const owned = useMemo(() => (snapshot ? ownershipMap(snapshot) : null), [snapshot]);

  // The resolvable, currently-unclaimed route ids for whichever kind's info modal is open. At most
  // one active/forecast instance of a given kind exists at once (the schedule generator's
  // gap-spacing invariant never overlaps two windows), so matching purely on `kind` is unambiguous.
  const infoRouteIds = useMemo(() => {
    if (!ev || !infoKind) return [];
    const active = ev.active.find((a) => a.kind === infoKind)?.routeIds;
    const raw = active ?? (ev.forecast?.kind === infoKind ? ev.forecast.routeIds : []);
    return raw.filter((rid) => !owned?.has(rid) && routeById.has(rid));
  }, [ev, infoKind, owned]);

  if (!ev) return null;

  const me = snapshot?.you?.playerId ?? null;
  const seatOf = (id: string): number => snapshot?.players.find((p) => p.id === id)?.seat ?? 0;
  const forecast = ev.forecast;

  // The affected-target summary for one active entry, resolved from public projection data.
  const affected = (info: RandomEventInfo): string | null => {
    if (info.kind === 'VIRAL_HOTSPOT' && info.cityId) return cityName(info.cityId, locale);
    if (info.kind === 'BENTO_RUSH' && info.cityId)
      return t('events.bentoCity', { city: cityName(info.cityId, locale) });
    if (info.kind === 'STATION_FRONT_NIGHT_MARKET' && info.cityId)
      return t('events.nightMarketCity', { city: cityName(info.cityId, locale) });
    if (info.kind === 'GODDESS_PROCESSION' && info.cityPath.length > 0) {
      const current = info.cityPath[Math.min(info.position, info.cityPath.length - 1)];
      if (current) return t('events.processionAt', { city: cityName(current, locale) });
    }
    if (info.kind === 'HARVEST_FESTIVAL_EXPRESS' && info.region) return info.region;
    if (info.kind === 'SPRING_FESTIVAL_RUSH') return t('events.reversedDirection');
    if (info.routeIds.length > 0) return t('events.affectedRoutes', { n: info.routeIds.length });
    return null;
  };

  const resourcePlayers =
    snapshot?.players.filter(
      (player) =>
        player.bentoTokens > 0 ||
        player.blessings > 0 ||
        player.claimDiscounts > 0 ||
        player.repairPermits > 0,
    ) ?? [];

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

        {ev.lanternHost && (
          <div className="event-row event-persistent" data-testid="lantern-host-row">
            <span className="event-name">{t(eventNameKey('LANTERN_HOST_CITY'))}</span>
            <span className="event-summary">
              {t('events.hostCity', { city: cityName(ev.lanternHost.cityId, locale) })}
            </span>
            <button
              type="button"
              className="cell-view"
              aria-label={t('view')}
              title={t('view')}
              onClick={() => setInfoKind('LANTERN_HOST_CITY')}
            >
              <Info size={13} aria-hidden />
            </button>
          </div>
        )}

        {ev.boringActive && (
          <div className="event-row event-persistent">
            <span className="event-name">{t(eventNameKey('BREAKTHROUGH_BORING_MACHINE'))}</span>
            <span className="event-summary">{t('events.boringActive')}</span>
            <button
              type="button"
              className="cell-view"
              aria-label={t('view')}
              title={t('view')}
              onClick={() => setInfoKind('BREAKTHROUGH_BORING_MACHINE')}
            >
              <Info size={13} aria-hidden />
            </button>
          </div>
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

        {ev.luckyContracts.map((contract) => (
          <div key={contract.eventId} className="event-row event-persistent event-lucky">
            <span className="event-name">
              {t('events.luckyPair', {
                a: cityName(contract.cityA, locale),
                b: cityName(contract.cityB, locale),
              })}
            </span>
            {contract.wonByPlayerId !== '' && (
              <span className="event-won">
                {t('events.charterWon', {
                  name: nameOf({
                    id: contract.wonByPlayerId,
                    seat: seatOf(contract.wonByPlayerId),
                    isMe: contract.wonByPlayerId === me,
                  }),
                })}
              </span>
            )}
            <button
              type="button"
              className="cell-view"
              aria-label={t('view')}
              title={t('view')}
              onClick={() => setInfoKind('LUCKY_TICKET_STUB')}
            >
              <Info size={13} aria-hidden />
            </button>
          </div>
        ))}

        {ev.eventDraft && (
          <div className="event-row event-persistent">
            <span className="event-name">{t('events.draftTitle')}</span>
            <span className="event-summary">
              {t('events.draftProgress', {
                n: Math.max(0, ev.eventDraft.order.length - ev.eventDraft.pickIndex),
              })}
            </span>
          </div>
        )}

        {ev.pendingHiveDraw && (
          <div className="event-row event-persistent">
            <span className="event-name">{t('events.hiveTitle')}</span>
            <span className="event-summary">
              {t('events.hiveWaiting', {
                name: nameOf({
                  id: ev.pendingHiveDraw.playerId,
                  seat: seatOf(ev.pendingHiveDraw.playerId),
                  isMe: ev.pendingHiveDraw.playerId === me,
                }),
              })}{' '}
              ({ev.pendingHiveDraw.revealed.length}/{ev.pendingHiveDraw.maxDraws})
            </span>
          </div>
        )}

        {resourcePlayers.map((player) => {
          const counts = [
            player.bentoTokens > 0 ? t('events.bentoTokens', { n: player.bentoTokens }) : null,
            player.blessings > 0 ? t('events.blessings', { n: player.blessings }) : null,
            player.claimDiscounts > 0
              ? t('events.claimDiscounts', { n: player.claimDiscounts })
              : null,
            player.repairPermits > 0
              ? t('events.repairPermits', { n: player.repairPermits })
              : null,
          ].filter((value): value is string => value !== null);
          return (
            <div key={player.id} className="event-row event-resources">
              <span className="event-name">
                {nameOf({ id: player.id, seat: player.seat, isMe: player.id === me })}
              </span>
              <span className="event-summary">{counts.join(' · ')}</span>
            </div>
          );
        })}

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
            {infoRouteIds.length > 0 && (
              <div className="event-route-section">
                <h4>{t('events.routeListTitle')}</h4>
                <ul className="event-route-list">
                  {infoRouteIds.map((rid) => {
                    const r = routeById.get(rid);
                    if (!r) return null;
                    return (
                      <li key={rid}>
                        <button
                          type="button"
                          className="event-route-item"
                          onClick={() => {
                            setEventSpotlight({ kind: 'route', ids: [rid] });
                            setInfoKind(null);
                          }}
                        >
                          {cityName(r.a, locale)}–{cityName(r.b, locale)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
