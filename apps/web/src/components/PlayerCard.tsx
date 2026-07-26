// The in-game player card (issue #14): everything the tracker row no longer crams in. Docks over
// the rail column rather than opening a centred modal, because its primary action highlights the
// player's network on the board — the board has to stay readable while the card is open.
//
// Every value it shows is already public on the wire (counts-only PublicPlayerState, the public
// ownership/stations placements, and completedTickets); the derivation lives in
// @trm/client-core so the mobile sheet renders the same card.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Map as MapIcon, X } from 'lucide-react';
import type { GameSnapshot } from '@trm/proto';
import {
  playerCardView,
  isLowOnTrains,
  trainSupplyFraction,
} from '@trm/client-core/game/playerCard';
import { seatColor, teamColor } from '../theme/colors';
import { useAnimationsStore } from '../store/animations';
import { useUi } from '../store/ui';
import { usePlayerAvatar, usePlayerName } from '../game/playerName';
import { cityName, ticketLabel } from '../game/content';
import { SeatAvatar } from './SeatAvatar';

export function PlayerCard({
  snapshot,
  playerId,
  onClose,
}: {
  snapshot: GameSnapshot;
  playerId: string;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const nameOf = usePlayerName();
  const avatarOf = usePlayerAvatar();
  const setRouteReveal = useAnimationsStore((s) => s.setRouteReveal);
  const clearRouteReveal = useAnimationsStore((s) => s.clearRouteReveal);
  const [revealed, setRevealed] = useState(false);

  // Esc closes, matching the app's other dismissible overlays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // A highlight belongs to the card that turned it on: drop it when the card closes or swaps
  // to another player, so the board can never keep glowing someone else's network.
  useEffect(() => () => clearRouteReveal(), [playerId, clearRouteReveal]);

  const view = playerCardView(snapshot, playerId);
  if (!view) return null;

  const isMe = playerId === snapshot.you?.playerId;
  const name = nameOf({ id: playerId, seat: view.seat, isMe });
  const seat = seatColor(view.seat);
  const low = isLowOnTrains(view.trainCars);
  const pct = trainSupplyFraction(view.trainCars, view.trainCarsStart) * 100;
  const stationCities = view.stationCityIds.map((id) => cityName(id, locale)).join('、');

  const toggleReveal = (): void => {
    if (revealed) {
      clearRouteReveal();
      setRevealed(false);
      return;
    }
    setRouteReveal(view.seat, view.claimedRouteIds);
    setRevealed(true);
  };

  return (
    <aside
      className="player-card"
      role="dialog"
      aria-label={`${t('playerCard')} · ${name}`}
      style={{ ['--seat' as string]: seat }}
    >
      <header className="pcard-head">
        <SeatAvatar
          avatar={avatarOf({ id: playerId, seat: view.seat, displayName: name })}
          seat={view.seat}
          size={36}
        />
        <div className="pcard-who">
          <h4 className="pcard-name">
            {name}
            {view.isCurrent && <span className="pcard-chip">{t('nowTurn')}</span>}
            {view.team >= 0 && (
              <span className="tracker-team" style={{ background: teamColor(view.team) }}>
                {t('teamName', { n: view.team + 1 })}
              </span>
            )}
          </h4>
          <p className="pcard-meta">{t('seatNumber', { n: view.seat + 1 })}</p>
        </div>
        <button type="button" className="icon-button" aria-label={t('close')} onClick={onClose}>
          <X size={16} aria-hidden />
        </button>
      </header>

      <section className="pcard-sec">
        <h5 className="pcard-label">{t('currentScore')}</h5>
        <p className="pcard-total">
          <b>{view.total}</b>
          <span>{t('points')}</span>
        </p>
        <dl className="pcard-ledger">
          <div>
            <dt>{t('scoreFromRoutes')}</dt>
            <dd>{view.routePoints}</dd>
          </div>
          <div>
            <dt>{t('completedTickets')}</dt>
            <dd>+{view.ticketPoints}</dd>
          </div>
        </dl>
      </section>

      <section className="pcard-sec">
        <h5 className="pcard-label">{t('trainSupply')}</h5>
        <p className="pcard-cars">
          <b>{view.trainCars}</b>
          <span>/ {view.trainCarsStart}</span>
          {low && <em>{t('endgameSoon')}</em>}
        </p>
        <span className={low ? 'pcard-gauge low' : 'pcard-gauge'} aria-hidden>
          <i style={{ width: `${pct}%` }} />
        </span>
      </section>

      <section className="pcard-sec">
        <dl className="pcard-grid">
          <div>
            <dt>{t('cards')}</dt>
            <dd>{view.handCount}</dd>
          </div>
          <div>
            <dt>{t('tickets')}</dt>
            <dd>{view.ticketCount}</dd>
          </div>
          <div>
            <dt>{t('stations')}</dt>
            <dd>
              {view.stationCityIds.length}
              <small> / {view.stationsTotal}</small>
            </dd>
          </div>
        </dl>
      </section>

      <section className="pcard-sec">
        <h5 className="pcard-label">{t('network')}</h5>
        <p className="pcard-net">
          {t('networkRoutes', { count: view.claimedRouteIds.length })}
          {' · '}
          {view.stationCityIds.length > 0
            ? t('networkStations', { cities: stationCities })
            : t('networkNoStations')}
        </p>
        <button
          type="button"
          className={revealed ? 'pcard-action on' : 'pcard-action'}
          aria-pressed={revealed}
          disabled={view.claimedRouteIds.length === 0}
          onClick={toggleReveal}
        >
          <MapIcon size={14} aria-hidden /> {t(revealed ? 'hideNetwork' : 'showNetwork')}
        </button>
      </section>

      <section className="pcard-sec">
        <h5 className="pcard-label">
          {t('completedTickets')} <span className="pcard-public">{t('publicInfo')}</span>
        </h5>
        {view.completedTicketIds.length === 0 ? (
          <p className="pcard-empty">{t('noCompletedTickets')}</p>
        ) : (
          <ul className="pcard-tickets">
            {view.completedTicketIds.map((id) => {
              const label = ticketLabel(id, locale);
              if (!label) return null;
              return (
                <li key={id}>
                  <span>{label.a}</span>
                  <span className="pcard-rail" aria-hidden />
                  <span>{label.b}</span>
                  <b>+{label.value}</b>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {view.resources.length > 0 && (
        <section className="pcard-sec">
          <h5 className="pcard-label">{t('eventResources')}</h5>
          <p className="pcard-resources">
            {view.resources.map((r) => t(`events.${r.key}`, { n: r.n })).join(' · ')}
          </p>
        </section>
      )}
    </aside>
  );
}
