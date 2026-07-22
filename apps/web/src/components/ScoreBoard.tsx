import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Crown, Bot, Eye, Map as MapIcon, X } from 'lucide-react';
import type { GameSnapshot, PlayerFinal } from '@trm/proto';
import type { RoomMember } from '../net/rest';
import { api } from '../net/rest';
import { SEAT_COLORS, teamColor } from '../theme/colors';
import { seatByPlayer } from '../game/view';
import { teamStandings } from '@trm/client-core/game/teams';
import { usePlayerName } from '../game/playerName';
import { ticketById } from '../game/content';
import { useAnimationsStore } from '../store/animations';
import { useConfetti } from '../hooks/useConfetti';
import { useUi } from '../store/ui';
import { useSession } from '../store/session';
import { TicketCard } from './TicketCard';
import { StarRating } from './StarRating';
import { AdSlot } from './AdSlot';
import { DiscordGlyph } from './icons/DiscordGlyph';
import { openDiscord } from '../discord';
import { track } from '../lib/analytics';

const isBot = (id: string): boolean => id.startsWith('bot:');
const ticketValue = (id: string): number => ticketById.get(id)?.value ?? 0;

const RATED_GAMES_KEY = 'trm.ratedGameIds';
const FEEDBACK_MAX_LEN = 500;

function getRatedGameIds(): Set<string> {
  try {
    const raw = localStorage.getItem(RATED_GAMES_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function markGameRated(gameId: string): void {
  try {
    const ids = getRatedGameIds();
    ids.add(gameId);
    localStorage.setItem(RATED_GAMES_KEY, JSON.stringify([...ids]));
  } catch {
    /* storage unavailable */
  }
}

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

/** Post-game nudge for a guest who just played: their result never counted toward the
 *  leaderboard (guests are excluded server-side, see LeaderboardService.apply). Mirrors
 *  HomeScreen's GuestUpgradeCard, but the copy calls out the leaderboard specifically. */
function EndgameGuestUpgrade() {
  const { t } = useTranslation();
  const loading = useSession((s) => s.loading);
  const error = useSession((s) => s.error);
  const upgrade = useSession((s) => s.upgrade);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="home-guest-card scoreboard-guest-card" data-testid="scoreboard-guest-upgrade">
      <p>{t('endgameGuestNotice')}</p>
      {!open ? (
        <button className="link home-guest-link" onClick={() => setOpen(true)}>
          {t('createAccount')}
        </button>
      ) : (
        <div className="stack">
          <p className="muted">{t('endgameUpgradeBlurb')}</p>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('email')}
            autoComplete="email"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('password')}
            autoComplete="new-password"
          />
          <button
            className="accent"
            disabled={loading || !email || password.length < 8}
            onClick={() => void upgrade(email, password)}
          >
            {t('createAccount')}
          </button>
          {error && <p className="error">{error}</p>}
        </div>
      )}
    </div>
  );
}

export function ScoreBoard({
  snapshot,
  onLeave,
  isHost,
  members,
  onVote,
  onPlayAgain,
}: {
  snapshot: GameSnapshot;
  onLeave(): void;
  isHost?: boolean | undefined;
  members?: RoomMember[] | undefined;
  onVote?: ((wantsRematch: boolean) => void) | undefined;
  onPlayAgain?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const playerName = usePlayerName();
  const setRouteReveal = useAnimationsStore((s) => s.setRouteReveal);
  const clearRouteReveal = useAnimationsStore((s) => s.clearRouteReveal);
  const gameId = useUi((s) => s.gameId);
  const roomCode = useUi((s) => s.roomCode);
  const user = useSession((s) => s.user);

  const [ticketModal, setTicketModal] = useState<TicketModal | null>(null);
  const [viewingMap, setViewingMap] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [stars, setStars] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ratingError, setRatingError] = useState(false);
  const [alreadyRated, setAlreadyRated] = useState(() => !!gameId && getRatedGameIds().has(gameId));

  const submitRating = async (): Promise<void> => {
    if (!gameId || !roomCode || stars === 0) return;
    setSubmitting(true);
    setRatingError(false);
    const text = feedback.trim();
    try {
      await api.submitRating({ gameId, roomId: roomCode, stars, ...(text ? { text } : {}) });
      track('rating_submit', { stars });
      markGameRated(gameId);
      setAlreadyRated(true);
    } catch {
      setRatingError(true);
    } finally {
      setSubmitting(false);
    }
  };

  useConfetti(!viewingMap && !dismissed);

  // Always drop any lingering map highlight when the scoreboard unmounts (e.g. leaving the game).
  useEffect(() => () => clearRouteReveal(), [clearRouteReveal]);

  const fs = snapshot.finalScores;
  if (!fs) return null;

  const seats = seatByPlayer(snapshot);
  const winners = new Set(fs.ranking[0]?.playerIds ?? []);
  // Team standings (empty in a free-for-all) — the authoritative result in a team game.
  const teams = teamStandings(snapshot);
  const sorted = [...fs.players].sort((a, b) => b.total - a.total);
  // Only games played with random events carry the ✨ column — an events-off (or pre-events)
  // game would otherwise show an all-zero column.
  const showEventBonus =
    snapshot.randomEvents !== undefined || fs.players.some((pf) => pf.eventBonus > 0);
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

  // Inspect-map mode: the player dismissed the scoreboard to pan/zoom the final board freely.
  // A small floating bar offers to reopen the scoreboard or leave the game directly.
  if (dismissed) {
    return (
      <div className="scoreboard-review">
        <div className="review-bar">
          <span className="review-caption">
            <MapIcon size={15} aria-hidden /> {t('inspectingMap')}
          </span>
          <button className="primary" onClick={() => setDismissed(false)}>
            {t('backToScores')}
          </button>
          <button onClick={onLeave}>{t('leaveGame')}</button>
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

  const myVote = members?.find((m) => m.userId === snapshot.you?.playerId)?.wantsRematch ?? false;
  const humanMembers = members?.filter((m) => !m.isBot) ?? [];
  const rematchCount = humanMembers.filter((m) => m.wantsRematch).length;

  return (
    <div className="modal-backdrop">
      <div className="modal scoreboard" role="dialog" aria-modal="true">
        <h3>{t('gameOver')}</h3>
        {teams.length > 0 && (
          // Team game: the TEAM result is the outcome that matters, so it leads. The per-player
          // table below still shows each member's own contribution.
          <div className="team-standings" aria-label={t('teamScoreboard')}>
            {teams.map((row) => (
              <div
                key={row.team}
                className={row.place === 1 ? 'team-standing winner' : 'team-standing'}
                style={{ borderColor: teamColor(row.team) }}
              >
                <span className="team-standing-name" style={{ color: teamColor(row.team) }}>
                  {row.place === 1 && <Crown size={14} aria-hidden />}
                  {t('teamName', { n: row.team + 1 })}
                </span>
                <span className="team-standing-members">
                  {row.memberIds.map((id) => nameOf(id)).join(' · ')}
                </span>
                <span className="team-standing-total">{row.total}</span>
              </div>
            ))}
          </div>
        )}
        <div className="scoreboard-scroll">
          <table>
            <thead>
              <tr>
                <th>{t('player')}</th>
                <th title={t('routePoints')}>🚆 {t('routePoints')}</th>
                <th title={t('completedTickets')}>✅ {t('completedTickets')}</th>
                <th title={t('failedTickets')}>❌ {t('failedTickets')}</th>
                <th title={t('stationBonus')}>🚉 {t('stationBonus')}</th>
                <th title={t('longestPath')}>📏 {t('longestPath')}</th>
                {showEventBonus && <th title={t('eventScoreBonus')}>✨ {t('eventScoreBonus')}</th>}
                <th>{t('totalScore')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((pf) => {
                const seat = seatOf(pf.playerId);
                const name = nameOf(pf.playerId);
                const { completed, failed, gain, loss } = ticketSplit(pf);
                return (
                  <tr key={pf.playerId} className={winners.has(pf.playerId) ? 'winner' : ''}>
                    <td className="player">
                      <span className="player-cell">
                        <span
                          className="seat-dot"
                          style={{ background: SEAT_COLORS[seat % 6] ?? '#888' }}
                        />
                        {winners.has(pf.playerId) && <Crown size={14} aria-hidden />}
                        {isBot(pf.playerId) && <Bot size={13} aria-hidden />}
                        <span className="player-name" title={name}>
                          {name}
                        </span>
                      </span>
                    </td>
                    <td className="num" data-label={t('routePoints')}>
                      {pf.routePoints}
                    </td>
                    <td className="num gain" data-label={t('completedTickets')}>
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
                    <td className="num loss" data-label={t('failedTickets')}>
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
                    <td className="num" data-label={t('stationBonus')}>
                      +{pf.stationBonus}
                    </td>
                    <td className="num longest" data-label={t('longestPath')}>
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
                    {showEventBonus && (
                      <td className="num" data-label={t('eventScoreBonus')}>
                        +{pf.eventBonus}
                      </td>
                    )}
                    <td className="num total" data-label={t('totalScore')}>
                      <b>{pf.total}</b>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {gameId && roomCode && snapshot.you && user?.isGuest && <EndgameGuestUpgrade />}
        {/* Post-game results: no active gameplay, high dwell — a policy-safe moment. Separated from
            the rematch / rating controls below by its own labelled block so it can't be mis-clicked. */}
        <AdSlot placement="postgame" reserveHeight={250} className="scoreboard-ad" />
        {members && snapshot.you && (onVote || onPlayAgain) && (
          <div className="row between rematch-row">
            <span className="muted">
              {t('rematchTally', { count: rematchCount, total: humanMembers.length })}
            </span>
            <div className="row">
              {onVote && (
                <button
                  className={myVote ? 'success' : ''}
                  onClick={() => {
                    track('rematch_vote', { wants: !myVote });
                    onVote(!myVote);
                  }}
                >
                  🔁 {t('wantRematch')}
                </button>
              )}
              {isHost && onPlayAgain && (
                <button
                  className="primary"
                  onClick={() => {
                    track('play_again', {});
                    onPlayAgain();
                  }}
                >
                  {t('playAgain')}
                </button>
              )}
            </div>
          </div>
        )}
        {gameId && roomCode && (
          <div className="scoreboard-rating">
            <span className="scoreboard-rating-label">{t('rateAppPrompt')}</span>
            {alreadyRated ? (
              <span className="scoreboard-rating-thanks">{t('ratingThanks')}</span>
            ) : (
              <>
                <StarRating value={stars} onChange={setStars} size={32} disabled={submitting} />
                {stars > 0 && (
                  <textarea
                    className="scoreboard-rating-feedback"
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value.slice(0, FEEDBACK_MAX_LEN))}
                    maxLength={FEEDBACK_MAX_LEN}
                    placeholder={t('ratingFeedbackPlaceholder')}
                    disabled={submitting}
                    rows={3}
                  />
                )}
                <button
                  className="primary"
                  disabled={stars === 0 || submitting}
                  onClick={() => void submitRating()}
                >
                  {t('submitRating')}
                </button>
                {ratingError && <p className="error">{t('ratingSubmitError')}</p>}
              </>
            )}
          </div>
        )}
        <div className="scoreboard-discord">
          <button
            className="discord-cta"
            onClick={() => {
              track('discord_click', { source: 'endgame' });
              openDiscord();
            }}
          >
            <DiscordGlyph size={18} /> {t('home.welcome.discordCta')}
          </button>
        </div>
        <div className="scoreboard-actions">
          <button onClick={() => setDismissed(true)}>
            <MapIcon size={14} aria-hidden /> {t('inspectMap')}
          </button>
          <button className="primary" onClick={onLeave}>
            {t('leaveGame')}
          </button>
        </div>
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
