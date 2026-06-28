import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Train, Building2, Trophy, Layers, Ticket, Bot } from 'lucide-react';
import type { GameSnapshot } from '@trm/proto';
import { SEAT_COLORS } from '../theme/colors';
import { useAnimations } from '../store/animations';

const isBot = (id: string): boolean => id.startsWith('bot:');

export function PlayerTrackers({ snapshot }: { snapshot: GameSnapshot }) {
  const { t } = useTranslation();
  const turnCue = useAnimations((s) => s.turnCue);
  const clearTurnCue = useAnimations((s) => s.clearTurnCue);

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
        return (
          <li
            key={cued ? `${p.id}:${turnCue!.id}` : p.id}
            className={(current ? 'tracker current' : 'tracker') + cueCls}
            data-player-id={p.id}
          >
            <span
              className="seat-dot"
              style={{ background: SEAT_COLORS[p.seat % 5] ?? '#888' }}
              aria-hidden
            />
            {isBot(p.id) && <Bot size={13} aria-hidden />}
            <span className="tracker-name">{isMe ? t('you') : `P${p.seat + 1}`}</span>
            <span className="tracker-stats">
              <span title="trains">
                <Train size={13} aria-hidden /> {p.trainCars}
              </span>
              <span title="score">
                <Trophy size={13} aria-hidden /> {p.routePoints}
              </span>
              <span title="cards">
                <Layers size={13} aria-hidden /> {p.handCount}
              </span>
              <span title="tickets">
                <Ticket size={13} aria-hidden /> {p.ticketCount}
              </span>
              <span title="stations">
                <Building2 size={13} aria-hidden /> {p.stationsRemaining}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
