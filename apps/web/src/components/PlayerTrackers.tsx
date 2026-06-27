import { useTranslation } from 'react-i18next';
import { Train, Building2, Trophy, Layers, Ticket } from 'lucide-react';
import type { GameSnapshot } from '@trm/proto';
import { SEAT_COLORS } from '../theme/colors';

export function PlayerTrackers({ snapshot }: { snapshot: GameSnapshot }) {
  const { t } = useTranslation();
  return (
    <ul className="trackers">
      {snapshot.players.map((p) => {
        const current = p.id === snapshot.currentPlayerId;
        const isMe = p.id === snapshot.you?.playerId;
        return (
          <li key={p.id} className={current ? 'tracker current' : 'tracker'}>
            <span
              className="seat-dot"
              style={{ background: SEAT_COLORS[p.seat % 5] ?? '#888' }}
              aria-hidden
            />
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
