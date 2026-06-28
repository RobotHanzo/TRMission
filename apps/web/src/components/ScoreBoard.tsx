import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Crown, Bot, Eye, Map as MapIcon, X } from 'lucide-react';
import type { GameSnapshot, PlayerFinal } from '@trm/proto';
import { SEAT_COLORS } from '../theme/colors';
import { seatByPlayer } from '../game/view';
import { usePlayerName } from '../game/playerName';
import { ticketById } from '../game/content';
import { useAnimationsStore } from '../store/animations';
import { useConfetti } from '../hooks/useConfetti';
import { TicketCard } from './TicketCard';

const isBot = (id: string): boolean => id.startsWith('bot:');
const ticketValue = (id: string): number => ticketById.get(id)?.value ?? 0;

/** Completed (gains) vs failed (losses) kept tickets, with their point sums. */
function ticketSplit(pf: PlayerFinal): {
  completed: string[];
  failed: string[];
  gain: number;
  loss: number;
} {
  const completedSet = new Set(pf.completedTicketIds);
  const completed = pf.completedTicketIds;
  const failed = pf.keptTicketIds.filter((id) => !completedSet.has(id));
  const gain = completed.reduce((s, id) => s + ticketValue(id), 0);
  const loss = failed.reduce((s, id) => s + ticketValue(id), 0);
  return { completed, failed, gain, loss };
}

type TicketModal = { kind: 'completed' | 'failed'; playerId: string };

export function ScoreBoard({ snapshot, onLeave }: { snapshot: GameSnapshot; onLeave(): void }) {
  const { t } = useTranslation();
  const playerName = usePlayerName();
  const setRouteReveal = useAnimationsStore((s) => s.setRouteReveal);
  const clearRouteReveal = useAnimationsStore((s) => s.clearRouteReveal);

  const [ticketModal, setTicketModal] = useState<TicketModal | null>(null);
  const [viewingMap, setViewingMap] = useState<string | null>(null);

  useConfetti(!viewingMap);

  // Always drop any lingering map highlight when the scoreboard unmounts (e.g. leaving the game).
  useEffect(() => () => clearRouteReveal(), [clearRouteReveal]);

  const fs = snapshot.finalScores;
  if (!fs) return null;

  const seats = seatByPlayer(snapshot);
  const winners = new Set(fs.ranking[0]?.playerIds ?? []);
  const sorted = [...fs.players].sort((a, b) => b.total - a.total);
  const seatOf = (id: string): number => seats.get(id) ?? 0;
  const nameOf = (id: string): string =>
    playerName({ id, seat: seatOf(id), isMe: id === snapshot.you?.playerId });

  const openMap = (pf: PlayerFinal): void => {
    if (pf.longestTrailRouteIds.length === 0) return;
    setRouteReveal(seatOf(pf.playerId), [...pf.longestTrailRouteIds]);
    setViewingMap(pf.playerId);
  };
  const backToScores = (): void => {
    clearRouteReveal();
    setViewingMap(null);
  };

  // Map-review mode: hide the scoreboard so the board shows the highlighted longest route, leaving
  // only a top bar to read it and return. The backdrop is gone, so the board stays pannable.
  if (viewingMap) {
    const pf = fs.players.find((p) => p.playerId === viewingMap);
    return (
      <div className="scoreboard-review">
        <div className="review-bar">
          <span className="review-caption">
            <MapIcon size={15} aria-hidden /> {t('longestRouteOf', { name: nameOf(viewingMap) })}
            {pf &&
              ` · ${t('longestDetail', { cars: pf.longestTrailLength, pts: pf.longestBonus })}`}
          </span>
          <button className="primary" onClick={backToScores}>
            {t('backToScores')}
          </button>
        </div>
      </div>
    );
  }

  const modalPlayer = ticketModal && fs.players.find((p) => p.playerId === ticketModal.playerId);
  const modalIds = modalPlayer
    ? ticketModal!.kind === 'completed'
      ? ticketSplit(modalPlayer).completed
      : ticketSplit(modalPlayer).failed
    : [];

  return (
    <div className="modal-backdrop">
      <div className="modal scoreboard" role="dialog" aria-modal="true">
        <h3>{t('gameOver')}</h3>
        <div className="scoreboard-scroll">
          <table>
            <thead>
              <tr>
                <th />
                <th>{t('player')}</th>
                <th title={t('routePoints')}>🚆 {t('routePoints')}</th>
                <th title={t('completedTickets')}>✅ {t('completedTickets')}</th>
                <th title={t('failedTickets')}>❌ {t('failedTickets')}</th>
                <th title={t('stationBonus')}>🚉 {t('stationBonus')}</th>
                <th title={t('longestPath')}>📏 {t('longestPath')}</th>
                <th>{t('totalScore')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((pf) => {
                const seat = seatOf(pf.playerId);
                const { completed, failed, gain, loss } = ticketSplit(pf);
                return (
                  <tr key={pf.playerId} className={winners.has(pf.playerId) ? 'winner' : ''}>
                    <td>
                      <span
                        className="seat-dot"
                        style={{ background: SEAT_COLORS[seat % 5] ?? '#888' }}
                      />
                      {winners.has(pf.playerId) && <Crown size={14} aria-hidden />}
                    </td>
                    <td>
                      {isBot(pf.playerId) && <Bot size={13} aria-hidden />} {nameOf(pf.playerId)}
                    </td>
                    <td className="num">{pf.routePoints}</td>
                    <td className="num gain">
                      <span className="cell-value">
                        +{gain}
                        {completed.length > 0 && (
                          <button
                            className="cell-view"
                            aria-label={t('view')}
                            title={t('view')}
                            onClick={() =>
                              setTicketModal({ kind: 'completed', playerId: pf.playerId })
                            }
                          >
                            <Eye size={13} aria-hidden />
                          </button>
                        )}
                      </span>
                    </td>
                    <td className="num loss">
                      <span className="cell-value">
                        {loss > 0 ? `−${loss}` : '0'}
                        {failed.length > 0 && (
                          <button
                            className="cell-view"
                            aria-label={t('view')}
                            title={t('view')}
                            onClick={() =>
                              setTicketModal({ kind: 'failed', playerId: pf.playerId })
                            }
                          >
                            <Eye size={13} aria-hidden />
                          </button>
                        )}
                      </span>
                    </td>
                    <td className="num">+{pf.stationBonus}</td>
                    <td className="num longest">
                      <span className="cell-value">
                        {t('longestDetail', { cars: pf.longestTrailLength, pts: pf.longestBonus })}
                        {pf.longestTrailRouteIds.length > 0 && (
                          <button
                            className="cell-view"
                            aria-label={t('viewOnMap')}
                            title={t('viewOnMap')}
                            onClick={() => openMap(pf)}
                          >
                            <MapIcon size={13} aria-hidden />
                          </button>
                        )}
                      </span>
                    </td>
                    <td className="num total">
                      <b>{pf.total}</b>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button className="primary" onClick={onLeave}>
          {t('back')}
        </button>
      </div>

      {ticketModal && modalPlayer && (
        <div className="modal-backdrop" onClick={() => setTicketModal(null)}>
          <div
            className="modal ticket-list-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ticket-list-head">
              <h3>
                {t(ticketModal.kind === 'completed' ? 'completedTickets' : 'failedTickets')} ·{' '}
                {nameOf(ticketModal.playerId)}
              </h3>
              <button
                className="icon-button"
                aria-label={t('close')}
                onClick={() => setTicketModal(null)}
              >
                <X size={16} aria-hidden />
              </button>
            </div>
            <div className="ticket-list-grid">
              {modalIds.map((id) => (
                <TicketCard key={id} ticketId={id} completed={ticketModal.kind === 'completed'} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
