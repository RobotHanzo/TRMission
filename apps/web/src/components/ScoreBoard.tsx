import { useTranslation } from 'react-i18next';
import { Crown } from 'lucide-react';
import type { GameSnapshot } from '@trm/proto';
import { SEAT_COLORS } from '../theme/colors';
import { seatByPlayer } from '../game/view';

export function ScoreBoard({ snapshot, onLeave }: { snapshot: GameSnapshot; onLeave(): void }) {
  const { t } = useTranslation();
  const fs = snapshot.finalScores;
  if (!fs) return null;

  const seats = seatByPlayer(snapshot);
  const winners = new Set(fs.ranking[0]?.playerIds ?? []);
  const sorted = [...fs.players].sort((a, b) => b.total - a.total);

  return (
    <div className="modal-backdrop">
      <div className="modal scoreboard" role="dialog" aria-modal="true">
        <h3>{t('gameOver')}</h3>
        <table>
          <thead>
            <tr>
              <th />
              <th>{t('player')}</th>
              <th title="routes">🚆</th>
              <th title="tickets">🎫</th>
              <th title="longest">📏</th>
              <th>{t('score')}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => {
              const seat = seats.get(p.playerId) ?? 0;
              const isMe = p.playerId === snapshot.you?.playerId;
              return (
                <tr key={p.playerId} className={winners.has(p.playerId) ? 'winner' : ''}>
                  <td>
                    <span
                      className="seat-dot"
                      style={{ background: SEAT_COLORS[seat % 5] ?? '#888' }}
                    />
                    {winners.has(p.playerId) && <Crown size={14} aria-hidden />}
                  </td>
                  <td>{isMe ? t('you') : `P${seat + 1}`}</td>
                  <td>{p.routePoints}</td>
                  <td>{p.ticketNet}</td>
                  <td>{p.longestBonus > 0 ? '★' : ''}</td>
                  <td>
                    <b>{p.total}</b>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button className="primary" onClick={onLeave}>
          {t('back')}
        </button>
      </div>
    </div>
  );
}
