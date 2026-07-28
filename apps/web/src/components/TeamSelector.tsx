import { useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, Bot, Crown, Shuffle, UserMinus, X } from 'lucide-react';
import type { RoomView, RoomMember, RoomSettings } from '../net/rest';
import { seatColor, teamColor } from '../theme/colors';

type TeamAssignMode = RoomSettings['teamAssignMode'];

const HINT_KEY: Record<TeamAssignMode, string> = {
  random: 'teamHintRandom',
  host: 'teamHintHost',
  self: 'teamHintSelf',
};

interface TeamSelectorProps {
  room: RoomView;
  isHost: boolean;
  myUserId: string | undefined;
  memberName: (m: RoomMember) => string;
  /** Host-assign mode: move `userId` onto `team`, counterpart chosen for the host. */
  onAssign: (userId: string, team: number) => void;
  /** Host-assign mode: trade the seats of two specific players on different teams. */
  onSwap: (userIdA: string, userIdB: string) => void;
  /** Self-join mode: move the caller onto `team`. */
  onJoinTeam: (team: number) => void;
  /** Random mode: reshuffle everyone. */
  onShuffle: () => void;
  onRemoveBot: (botId: string) => void;
  onTransferHost: (userId: string) => void;
  onKick: (userId: string) => void;
}

/**
 * Replaces the flat member list whenever team mode is on: one "platform board" column per team
 * (ribbon in the team's own colour), rendered per the room's `teamAssignMode` — read-only +
 * host shuffle button (random), pick-then-place (host), or a per-column Join button (self).
 *
 * Host-assign has two placements once a player is picked, both available by tap or by drag, so
 * the host never has to re-try a move to land the pairing they wanted:
 *   - onto another team's PLAYER → those two trade seats (`onSwap`); the host names both ends.
 *   - onto another team's HEADER/empty space → `onAssign` picks the counterpart (lowest seat).
 * Tapping a player on the picked player's own team just moves the pick there.
 *
 * Host powers (kick/transfer/remove bot) stay available on every chip regardless of mode.
 */
export function TeamSelector({
  room,
  isHost,
  myUserId,
  memberName,
  onAssign,
  onSwap,
  onJoinTeam,
  onShuffle,
  onRemoveBot,
  onTransferHost,
  onKick,
}: TeamSelectorProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const mode = room.settings.teamAssignMode;
  const teamCount = room.settings.teamCount;
  const assignable = mode === 'host' && isHost;
  // Either interaction resolves to the same active member; a column or an opposing chip lights up
  // as a valid drop target for whichever one is in flight.
  const activeUserId = selected ?? dragging;

  const teams = Array.from({ length: teamCount }, (_, team) => ({
    team,
    members: room.members
      .filter((m) => m.seat % teamCount === team)
      .sort((a, b) => a.seat - b.seat),
  }));

  const teamOfUser = (userId: string): number | null => {
    const m = room.members.find((x) => x.userId === userId);
    return m ? m.seat % teamCount : null;
  };
  const activeTeam = activeUserId === null ? null : teamOfUser(activeUserId);
  /** A chip the active player can be traded WITH: someone else, on some other team. */
  const isSwapTarget = (userId: string): boolean =>
    assignable &&
    activeTeam !== null &&
    userId !== activeUserId &&
    teamOfUser(userId) !== activeTeam;

  const clearPick = () => {
    setSelected(null);
    setDragging(null);
  };
  const assignToColumn = (userId: string, team: number) => {
    onAssign(userId, team);
    clearPick();
  };
  const swapWith = (userId: string) => {
    if (activeUserId === null) return;
    onSwap(activeUserId, userId);
    clearPick();
  };
  /** Tapping an opposing chip completes the swap; anything else just (re)picks. */
  const clickChip = (userId: string) => {
    if (isSwapTarget(userId)) {
      swapWith(userId);
      return;
    }
    setSelected((cur) => (cur === userId ? null : userId));
  };
  const dropOnColumn = (team: number) => {
    if (!assignable || selected === null) return;
    assignToColumn(selected, team);
  };
  const handleChipDragStart = (userId: string) => (e: DragEvent<HTMLButtonElement>) => {
    e.dataTransfer.setData('text/plain', userId);
    e.dataTransfer.effectAllowed = 'move';
    setDragging(userId);
  };
  const handleColumnDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!assignable) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const handleColumnDrop = (team: number) => (e: DragEvent<HTMLDivElement>) => {
    if (!assignable) return;
    e.preventDefault();
    const userId = e.dataTransfer.getData('text/plain');
    if (userId) assignToColumn(userId, team);
  };
  // Chip-level drop wins over the column it sits in — that's the whole point of aiming at a
  // player — so it stops the event before the column's handler picks a counterpart instead.
  const handleChipDragOver = (e: DragEvent<HTMLLIElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
  };
  const handleChipDrop = (userId: string) => (e: DragEvent<HTMLLIElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const dragged = e.dataTransfer.getData('text/plain');
    if (dragged && dragged !== userId) {
      onSwap(dragged, userId);
      clearPick();
    }
  };

  return (
    <div className="team-board-wrap">
      <div className="row between team-board-head">
        <div>
          <h4>{t('teamSeatingTitle')}</h4>
          <span className="muted">{t(HINT_KEY[mode])}</span>
        </div>
        {isHost && mode === 'random' && (
          <button type="button" className="team-shuffle-btn" onClick={onShuffle}>
            <Shuffle size={16} aria-hidden /> {t('shuffleTeams')}
          </button>
        )}
      </div>
      <div className="team-board">
        {teams.map(({ team, members }) => {
          const isMyTeam = members.some((m) => m.userId === myUserId);
          const dropActive =
            assignable && activeUserId !== null && !members.some((m) => m.userId === activeUserId);
          return (
            <div
              key={team}
              className={dropActive ? 'team-column team-column-drop-target' : 'team-column'}
              onDragOver={assignable ? handleColumnDragOver : undefined}
              onDrop={assignable ? handleColumnDrop(team) : undefined}
            >
              <button
                type="button"
                className={
                  dropActive ? 'team-column-header team-column-drop' : 'team-column-header'
                }
                style={{ background: teamColor(team) }}
                disabled={!dropActive}
                onClick={() => dropOnColumn(team)}
              >
                <span>{t('teamName', { n: team + 1 })}</span>
                <span className="team-column-count">{members.length}</span>
              </button>
              <ul className="team-chip-list">
                {members.map((m) => {
                  const swapTarget = isSwapTarget(m.userId);
                  const chipContent = (
                    <>
                      <span
                        className="seat-dot"
                        style={{ background: seatColor(m.seat) }}
                        aria-hidden
                      />
                      {m.isBot && <Bot size={15} aria-hidden />}
                      <span className="team-chip-name" title={memberName(m)}>
                        {memberName(m)}
                        {m.userId === room.hostId && <em className="muted"> ({t('host')})</em>}
                        {m.userId === myUserId && <em className="muted"> ({t('you')})</em>}
                      </span>
                      {m.isBot ? (
                        <span className="badge bot">{t('botTag')}</span>
                      ) : (
                        <span className={m.ready ? 'badge ok' : 'badge'}>
                          {m.ready ? t('ready') : t('notReady')}
                        </span>
                      )}
                      {swapTarget && (
                        <ArrowLeftRight className="team-chip-swap-icon" size={15} aria-hidden />
                      )}
                    </>
                  );
                  return (
                    <li
                      key={m.userId}
                      onDragOver={swapTarget ? handleChipDragOver : undefined}
                      onDrop={swapTarget ? handleChipDrop(m.userId) : undefined}
                    >
                      {assignable ? (
                        <button
                          type="button"
                          className={[
                            'team-chip',
                            selected === m.userId && 'selected',
                            dragging === m.userId && 'dragging',
                            swapTarget && 'swap-target',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          aria-pressed={selected === m.userId}
                          aria-label={
                            swapTarget ? t('teamSwapWith', { name: memberName(m) }) : undefined
                          }
                          draggable
                          onDragStart={handleChipDragStart(m.userId)}
                          onDragEnd={() => setDragging(null)}
                          onClick={() => clickChip(m.userId)}
                        >
                          {chipContent}
                        </button>
                      ) : (
                        <span className="team-chip">{chipContent}</span>
                      )}
                      {isHost && m.isBot && (
                        <button
                          className="icon-btn"
                          aria-label={t('removeBot')}
                          title={t('removeBot')}
                          onClick={() => onRemoveBot(m.userId)}
                        >
                          <X size={14} aria-hidden />
                        </button>
                      )}
                      {isHost && !m.isBot && m.userId !== room.hostId && (
                        <>
                          <button
                            className="icon-btn"
                            aria-label={t('makeOwner')}
                            title={t('makeOwner')}
                            onClick={() => onTransferHost(m.userId)}
                          >
                            <Crown size={14} aria-hidden />
                          </button>
                          <button
                            className="icon-btn"
                            aria-label={t('kickPlayer')}
                            title={t('kickPlayer')}
                            onClick={() => onKick(m.userId)}
                          >
                            <UserMinus size={14} aria-hidden />
                          </button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
              {mode === 'self' && myUserId && !isMyTeam && (
                <button type="button" className="team-join-btn" onClick={() => onJoinTeam(team)}>
                  {t('teamJoinButton')}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
