import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Train, Building2, Trophy, Layers, Ticket, Bot } from 'lucide-react';
import type { GameSnapshot } from '@trm/proto';
import { SEAT_COLORS, teamColor } from '../theme/colors';
import { useAnimationsStore } from '../store/animations';
import { playerLiveTotal } from '../game/tickets';
import { usePlayerName } from '../game/playerName';

const isBot = (id: string): boolean => id.startsWith('bot:');

export function PlayerTrackers({ snapshot }: { snapshot: GameSnapshot }) {
  const { t } = useTranslation();
  const nameOf = usePlayerName();
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
            {p.team >= 0 && (
              <span className="tracker-team" style={{ background: teamColor(p.team) }}>
                {t('teamName', { n: p.team + 1 })}
              </span>
            )}
            {isBot(p.id) && <Bot size={13} aria-hidden />}
            <span className="tracker-name">{nameOf({ id: p.id, seat: p.seat, isMe })}</span>
            <span className="tracker-stats">
              <span title={t('trainCars')}>
                <Train size={13} aria-hidden /> {p.trainCars}
              </span>
              <span title={t('score')}>
                <Trophy size={13} aria-hidden /> {playerLiveTotal(snapshot, p.id)}
              </span>
              <span title={t('cards')}>
                <Layers size={13} aria-hidden /> {p.handCount}
              </span>
              <span title={t('tickets')}>
                <Ticket size={13} aria-hidden /> {p.ticketCount}
              </span>
              <span title={t('stations')}>
                <Building2 size={13} aria-hidden /> {p.stationsRemaining}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
