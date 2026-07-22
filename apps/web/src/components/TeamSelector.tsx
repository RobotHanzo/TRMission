import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Crown, Shuffle, UserMinus, X } from 'lucide-react';
import type { RoomView, RoomMember, RoomSettings } from '../net/rest';
import { SEAT_COLORS, teamColor } from '../theme/colors';

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
  /** Host-assign mode: move `userId` onto `team`. */
  onAssign: (userId: string, team: number) => void;
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
 * host shuffle button (random), tap-a-player-then-tap-a-team (host), or a per-column Join button
 * (self). Host powers (kick/transfer/remove bot) stay available on every chip regardless of mode.
 */
export function TeamSelector({
  room,
  isHost,
  myUserId,
  memberName,
  onAssign,
  onJoinTeam,
  onShuffle,
  onRemoveBot,
  onTransferHost,
  onKick,
}: TeamSelectorProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const mode = room.settings.teamAssignMode;
  const teamCount = room.settings.teamCount;
  const assignable = mode === 'host' && isHost;

  const teams = Array.from({ length: teamCount }, (_, team) => ({
    team,
    members: room.members
      .filter((m) => m.seat % teamCount === team)
      .sort((a, b) => a.seat - b.seat),
  }));

  const selectChip = (userId: string) => {
    setSelected((cur) => (cur === userId ? null : userId));
  };
  const dropOnColumn = (team: number) => {
    if (!assignable || selected === null) return;
    onAssign(selected, team);
    setSelected(null);
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
            assignable && selected !== null && !members.some((m) => m.userId === selected);
          return (
            <div key={team} className="team-column">
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
                  const chipContent = (
                    <>
                      <span
                        className="seat-dot"
                        style={{ background: SEAT_COLORS[m.seat % 6] ?? '#888' }}
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
                    </>
                  );
                  return (
                    <li key={m.userId}>
                      {assignable ? (
                        <button
                          type="button"
                          className={selected === m.userId ? 'team-chip selected' : 'team-chip'}
                          aria-pressed={selected === m.userId}
                          onClick={() => selectChip(m.userId)}
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
