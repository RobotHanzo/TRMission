// Per-player status rows. Issue #14: a row carries only the two numbers that are read at a
// glance — the live score and the remaining train cars — and the row's own baseline IS the
// rolling-stock gauge (it depletes in the seat colour, and turns ember once the supply is low,
// so "who is about to end this game" reads without doing arithmetic). Everything else the row
// used to cram in (hand, missions, stations, event resources) moved into the PlayerCard that
// clicking a row opens.
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Train } from 'lucide-react';
import type { GameSnapshot } from '@trm/proto';
import { seatColor, teamColor } from '../theme/colors';
import { useAnimationsStore } from '../store/animations';
import { playerLiveTotal } from '../game/tickets';
import { usePlayerAvatar, usePlayerName } from '../game/playerName';
import { ACTIVE_RULES } from '../game/content';
import { isLowOnTrains, trainSupplyFraction } from '@trm/client-core/game/playerCard';
import { SeatAvatar } from './SeatAvatar';

export function PlayerTrackers({
  snapshot,
  onInspect,
  inspectedId,
}: {
  snapshot: GameSnapshot;
  /** Opens the player card. Omitted in surfaces that render trackers read-only. */
  onInspect?: ((playerId: string) => void) | undefined;
  inspectedId?: string | null | undefined;
}) {
  const { t } = useTranslation();
  const nameOf = usePlayerName();
  const avatarOf = usePlayerAvatar();
  const turnCue = useAnimationsStore((s) => s.turnCue);
  const clearTurnCue = useAnimationsStore((s) => s.clearTurnCue);

  useEffect(() => {
    if (!turnCue) return;
    const id = window.setTimeout(() => clearTurnCue(turnCue.id), 2200);
    return () => clearTimeout(id);
  }, [turnCue, clearTurnCue]);

  return (
    <ul className="trackers">
      {snapshot.players.map((p) => {
        const current = p.id === snapshot.currentPlayerId;
        const isMe = p.id === snapshot.you?.playerId;
        const cued = turnCue?.playerId === p.id;
        const cueCls = cued ? (turnCue!.isYou ? ' is-your-turn' : ' is-turn-cue') : '';
        const low = isLowOnTrains(p.trainCars);
        const name = nameOf({ id: p.id, seat: p.seat, isMe });
        const pct = trainSupplyFraction(p.trainCars, ACTIVE_RULES.trainCarsStart) * 100;
        const cls =
          (current ? 'tracker current' : 'tracker') +
          cueCls +
          (low ? ' low' : '') +
          (inspectedId === p.id ? ' inspected' : '');
        const body = (
          <>
            <SeatAvatar
              avatar={avatarOf({ id: p.id, seat: p.seat, displayName: name })}
              seat={p.seat}
            />
            {p.team >= 0 && (
              <span className="tracker-team" style={{ background: teamColor(p.team) }}>
                {t('teamName', { n: p.team + 1 })}
              </span>
            )}
            <span className="tracker-name">{name}</span>
            <span className="tracker-cars" title={t('trainCars')}>
              <Train size={13} aria-hidden /> {p.trainCars}
            </span>
            <span className="tracker-score" title={t('score')}>
              {playerLiveTotal(snapshot, p.id)}
            </span>
            {/* The row's baseline: remaining rolling stock, in this player's seat colour. */}
            <span className="tracker-gauge" aria-hidden>
              <i style={{ width: `${pct}%` }} />
            </span>
          </>
        );
        return (
          <li key={cued ? `${p.id}:${turnCue!.id}` : p.id} className="tracker-slot">
            {onInspect ? (
              <button
                type="button"
                className={cls}
                data-player-id={p.id}
                style={{ ['--seat' as string]: seatColor(p.seat) }}
                aria-label={t('inspectPlayer', { name })}
                aria-expanded={inspectedId === p.id}
                onClick={() => onInspect(p.id)}
              >
                {body}
              </button>
            ) : (
              <div
                className={cls}
                data-player-id={p.id}
                style={{ ['--seat' as string]: seatColor(p.seat) }}
              >
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
