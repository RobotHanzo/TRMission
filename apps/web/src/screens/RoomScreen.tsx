import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Crown, Globe, Lock, Map as MapIcon, UserMinus, X } from 'lucide-react';
import { OFFICIAL_MAPS } from '@trm/map-data';
import {
  layoutsForPlayerCount,
  seatOrderMovingToTeam,
  shuffleSeatOrder,
  TEAM_LAYOUTS,
  type EventsMode,
} from '@trm/shared';
import { useUi } from '../store/ui';
import { useHasFeature, useSession } from '../store/session';
import { startLobbyPoll } from '@trm/client-core/game/lobbyPoll';
import {
  api,
  type RoomView,
  type RoomMember,
  type RoomSettings,
  type RoomVisibility,
  type MapSelector,
  type MapSummary,
  type BotDifficulty,
} from '../net/rest';
import { connectGame } from '../net/connection';
import { track } from '../lib/analytics';
import { soundPlayer } from '../sound/player';
import { OPPONENT_GAIN } from '../sound/cues';
import { SEAT_COLORS } from '../theme/colors';
import { useAnimationsStore } from '../store/animations';
import { NotificationStack } from '../components/NotificationStack';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { OwnerLeaveDialog } from '../components/OwnerLeaveDialog';
import { useConfirmAction } from '../hooks/useConfirmAction';
import { Switch } from '../components/ui/Switch';
import { Segmented } from '../components/ui/Segmented';
import { TeamSelector } from '../components/TeamSelector';
import { AdSlot } from '../components/AdSlot';
import type { Locale } from '../store/ui';
import { chatPresetKey } from '@trm/client-core';
import { ChatPresetPicker } from '../components/ChatPresetPicker';
import '../styles/game.css';
import '../styles/room.css';

const DIFFICULTIES: readonly BotDifficulty[] = ['EASY', 'MEDIUM', 'HARD', 'HELL'];

/** Best-effort display name for the room's selected map. The server resolves this for official
 *  maps (`mapName`); for a custom map it falls back to the viewer's own map list, which only
 *  resolves for the host (a member who doesn't own the map sees a placeholder — the game itself
 *  still renders the correct content once started, this only affects the lobby's label). */
function mapDisplayName(
  selector: MapSelector,
  myMaps: MapSummary[] | null,
  mapName: { zh: string; en: string } | undefined,
  locale: Locale,
): string {
  if (mapName) return locale === 'en' ? mapName.en : mapName.zh;
  if (selector.source === 'official') {
    const m = OFFICIAL_MAPS.find((x) => x.mapId === selector.mapId);
    return m ? (locale === 'en' ? m.content.meta.nameEn : m.content.meta.nameZh) : selector.mapId;
  }
  const m = myMaps?.find((x) => x.id === selector.customMapId);
  return m ? (locale === 'en' ? m.nameEn : m.nameZh) : '…';
}

export function RoomScreen() {
  const { t } = useTranslation();
  const code = useUi((s) => s.roomCode) ?? '';
  const enterGame = useUi((s) => s.enterGame);
  const goHome = useUi((s) => s.goHome);
  const enterMaps = useUi((s) => s.enterMaps);
  const locale = useUi((s) => s.locale);
  const user = useSession((s) => s.user);
  const canBuild = useHasFeature('mapBuilder');
  const canConfigureEvents = useHasFeature('randomEvents');

  const [room, setRoom] = useState<RoomView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [kicked, setKicked] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [myMaps, setMyMaps] = useState<MapSummary[] | null>(null);
  const pushNotification = useAnimationsStore((s) => s.pushNotification);
  const {
    open: leaveOpen,
    request: requestLeave,
    confirm: confirmLeave,
    cancel: cancelLeave,
  } = useConfirmAction();
  const {
    open: closeOpen,
    request: requestClose,
    confirm: confirmClose,
    cancel: cancelClose,
  } = useConfirmAction();
  const {
    open: transferOpen,
    request: requestTransfer,
    confirm: confirmTransfer,
    cancel: cancelTransfer,
  } = useConfirmAction();
  const [ownerLeaveOpen, setOwnerLeaveOpen] = useState(false);

  // The host's own custom maps, for the picker's "custom" dropdown — fetched once, lazily,
  // only for whoever can actually change the setting AND holds the mapBuilder feature
  // (the endpoint 403s without it).
  useEffect(() => {
    if (!user || !canBuild) return;
    api
      .listMaps()
      .then(setMyMaps)
      .catch(() => setMyMaps([]));
  }, [user, canBuild]);

  // Poll the room (lobby push is a later enhancement); auto-enter the game when started. The
  // join/kick/spectate/terminal semantics live in client-core's startLobbyPoll (shared with
  // mobile) — this wires its outcomes to web routing and notifications.
  useEffect(() => {
    if (!code) return; // no room to poll (e.g. mid-navigation after leaving/being kicked)
    return startLobbyPoll(code, user?.id, api, {
      onRoom: setRoom,
      onEnterGame: (tk, { spectator }) => {
        connectGame(
          tk.ticket,
          spectator ? { roomCode: code, spectator: true } : { roomCode: code },
        );
        enterGame(tk.gameId, tk.ticket);
      },
      onGone: goHome,
      onKicked: () => setKicked(true),
      onFullRoomSpectateNotice: () =>
        pushNotification({ variant: 'notice', text: t('fullRoomSpectateNotice') }),
      onError: (message) => setErr(message),
    });
  }, [code, user?.id, enterGame, goHome, pushNotification, t]);

  // Play the same chatMessage cue the in-game chat uses (see useSoundDriver's seenChatId) — keyed
  // on ts rather than array index since the server caps room.chat to its last N entries, so an
  // index count would silently stop firing once a long-lived lobby chat gets truncated.
  const seenChatTs = useRef<number | null>(null);
  useEffect(() => {
    if (!room) return;
    const last = room.chat.at(-1)?.ts ?? 0;
    if (seenChatTs.current === null) {
      seenChatTs.current = last;
      return;
    }
    for (const entry of room.chat) {
      if (entry.ts <= seenChatTs.current) continue;
      soundPlayer.play('chatMessage', entry.userId === user?.id ? 1 : OPPONENT_GAIN);
    }
    seenChatTs.current = last;
  }, [room, user?.id]);

  if (!room)
    return (
      <div className="card stack">
        <span>{err ?? t('connecting')}</span>
        <button onClick={goHome}>{t('back')}</button>
      </div>
    );

  const me = room.members.find((m) => m.userId === user?.id);
  const mySpectator = room.spectators.find((s) => s.userId === user?.id);
  const isHost = room.hostId === user?.id;
  // A shareable link that drops a friend straight into this room (joins on open, after login).
  const roomLink = `${window.location.origin}/room/${code}`;
  const allReady = room.members.length >= 2 && room.members.every((m) => m.ready);
  const canAddBot = isHost && room.members.length < room.maxPlayers;

  const memberName = (m: RoomMember): string =>
    m.isBot ? t('botName', { level: t(`difficulty_${m.difficulty ?? 'EASY'}`) }) : m.displayName;
  const chatAuthorName = (userId: string): string => {
    const m = room.members.find((x) => x.userId === userId);
    if (m) return memberName(m);
    const s = room.spectators.find((x) => x.userId === userId);
    return s ? s.displayName : userId;
  };

  const guard = (p: Promise<RoomView>) => p.then(setRoom).catch((e: Error) => setErr(e.message));

  const settings = room.settings;
  const settingsLocked = !isHost || room.status !== 'LOBBY';
  // The host only sees the picker while holding the randomEvents feature; a non-host still sees
  // (read-only) whatever mode the host already configured, so it's never a mystery mid-game.
  const showEventsPicker = isHost ? canConfigureEvents : settings.eventsMode !== 'off';
  const teamCount = settings.teamCount ?? 0;
  // Whether the current head-count can actually form this many teams (4p→2, 6p→2 or 3).
  const teamLayoutOk =
    teamCount === 0 ||
    layoutsForPlayerCount(room.members.length).some((l) => l.teamCount === teamCount);
  const setSetting = (patch: Partial<RoomSettings>) => {
    track('room_settings_change', { setting: Object.keys(patch)[0] ?? 'unknown' });
    void guard(api.updateRoomSettings(code, patch));
  };
  const RULE_TOGGLES = [
    [
      'unlimitedStationBorrow',
      'settingUnlimitedStationBorrow',
      'settingUnlimitedStationBorrowDesc',
    ],
    [
      'secondDrawAfterBlindRainbow',
      'settingSecondDrawAfterRainbow',
      'settingSecondDrawAfterRainbowDesc',
    ],
    ['noUnfinishedTicketPenalty', 'settingNoUnfinishedPenalty', 'settingNoUnfinishedPenaltyDesc'],
    [
      'doubleRouteSingleFor23',
      'settingDoubleRouteSingleFor23',
      'settingDoubleRouteSingleFor23Desc',
    ],
  ] as const;

  const toggleReady = () => void guard(api.setReady(code, !me?.ready));
  const addBot = (d: BotDifficulty) => {
    track('bot_add', { difficulty: d });
    void guard(api.addBot(code, d));
  };
  const removeBot = (botId: string) => void guard(api.removeBot(code, botId));
  const kick = (userId: string) => void guard(api.kickPlayer(code, userId));
  /** Host-assign mode: move `userId` onto `team`, swapping seats with that team's current
   *  lowest-seat occupant (the one shared seat-math primitive, also used server-side for
   *  self-join). A no-op (null) when they're already on that team. */
  const assignToTeam = (userId: string, team: number) => {
    const order = seatOrderMovingToTeam(room.members, userId, team, teamCount);
    if (order) void guard(api.reseatRoom(code, order));
  };
  const joinTeam = (team: number) => void guard(api.joinTeam(code, team));
  const shuffleTeams = () => void guard(api.reseatRoom(code, shuffleSeatOrder(room.members)));
  const transferHost = (userId: string) => void guard(api.transferOwnership(code, userId));
  const sendChat = (presetId: string) => {
    track('chat_send', { kind: 'preset', context: 'lobby' });
    void guard(api.sendRoomChat(code, { presetId }));
  };
  const becomeSpectator = () => void guard(api.watchRoom(code));
  const becomePlayer = () => void guard(api.rejoinRoom(code));
  const copy = (text: string) => {
    if (!navigator.clipboard) return;
    void Promise.resolve(navigator.clipboard.writeText(text)).then(
      () => pushNotification({ variant: 'success', text: t('copied') }),
      () => undefined,
    );
  };
  const start = async () => {
    try {
      const tk = await api.startRoom(code);
      connectGame(tk.ticket, { roomCode: code });
      enterGame(tk.gameId, tk.ticket);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const leave = async () => {
    await api.leaveRoom(code).catch(() => undefined);
    goHome();
  };
  const otherHumans = room.members.filter((m) => m.userId !== user?.id && !m.isBot);
  const closeAndGoHome = async () => {
    await api.closeRoom(code).catch(() => undefined);
    goHome();
  };
  const transferAndLeave = async (targetId: string) => {
    setOwnerLeaveOpen(false);
    await api.transferOwnership(code, targetId).catch(() => undefined);
    await api.leaveRoom(code).catch(() => undefined);
    goHome();
  };
  const onLeaveClick = () => {
    track('room_leave', {});
    if (!isHost) {
      requestLeave(() => void leave());
    } else if (otherHumans.length === 0) {
      requestClose(() => void closeAndGoHome());
    } else {
      setOwnerLeaveOpen(true);
    }
  };

  return (
    <div className="room-layout">
      <div className="stack room-main">
        <div className="row between">
          <h2>
            {t('room')} <code className="room-code">{code}</code>
          </h2>
          <div className="row">
            <button onClick={() => copy(code)}>{t('copyCode')}</button>
            <button onClick={() => copy(roomLink)}>{t('copyLink')}</button>
          </div>
        </div>

        {teamCount > 0 ? (
          <TeamSelector
            room={room}
            isHost={isHost}
            myUserId={user?.id}
            memberName={memberName}
            onAssign={assignToTeam}
            onJoinTeam={joinTeam}
            onShuffle={shuffleTeams}
            onRemoveBot={removeBot}
            onTransferHost={(id) => requestTransfer(() => transferHost(id))}
            onKick={kick}
          />
        ) : (
          <ul className="member-list">
            {room.members.map((m) => (
              <li key={m.userId}>
                <span
                  className="seat-dot"
                  style={{ background: SEAT_COLORS[m.seat % 6] ?? '#888' }}
                  aria-hidden
                />
                {m.isBot && <Bot size={15} aria-hidden />}
                <span>{memberName(m)}</span>
                {m.userId === room.hostId && <em className="muted">({t('host')})</em>}
                {m.userId === user?.id && <em className="muted">({t('you')})</em>}
                {m.isBot ? (
                  <span className="badge bot">{t('botTag')}</span>
                ) : (
                  <span className={m.ready ? 'badge ok' : 'badge'}>
                    {m.ready ? t('ready') : t('notReady')}
                  </span>
                )}
                {isHost && m.isBot && (
                  <button
                    className="icon-btn"
                    aria-label={t('removeBot')}
                    title={t('removeBot')}
                    onClick={() => removeBot(m.userId)}
                  >
                    <X size={14} aria-hidden />
                  </button>
                )}
                {isHost && !m.isBot && m.userId !== room.hostId && (
                  <button
                    className="icon-btn"
                    aria-label={t('makeOwner')}
                    title={t('makeOwner')}
                    onClick={() => requestTransfer(() => transferHost(m.userId))}
                  >
                    <Crown size={14} aria-hidden />
                  </button>
                )}
                {isHost && !m.isBot && m.userId !== room.hostId && (
                  <button
                    className="icon-btn"
                    aria-label={t('kickPlayer')}
                    title={t('kickPlayer')}
                    onClick={() => kick(m.userId)}
                  >
                    <UserMinus size={14} aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {room.spectators.length > 0 && (
          <>
            <h4 className="muted">{t('spectatorsHeading')}</h4>
            <ul className="member-list spectator-list">
              {room.spectators.map((s) => (
                <li key={s.userId}>
                  <span>{s.displayName}</span>
                  {s.userId === user?.id && <em className="muted">({t('you')})</em>}
                  {isHost && (
                    <button
                      className="icon-btn"
                      aria-label={t('kickPlayer')}
                      title={t('kickPlayer')}
                      onClick={() => kick(s.userId)}
                    >
                      <UserMinus size={14} aria-hidden />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        <fieldset className="card stack game-settings" disabled={settingsLocked}>
          <legend>{t('gameSettings')}</legend>
          <div className="row between setting-row">
            <strong>{t('mapLabel')}</strong>
            {isHost ? (
              <div className="row">
                <Segmented<'official' | 'custom'>
                  options={
                    canBuild
                      ? [
                          { value: 'official', label: t('mapOfficial') },
                          { value: 'custom', label: t('mapCustom') },
                        ]
                      : [{ value: 'official', label: t('mapOfficial') }]
                  }
                  value={settings.map.source}
                  onChange={(src) => {
                    if (src === 'official') {
                      const first = OFFICIAL_MAPS[0];
                      if (first) setSetting({ map: { source: 'official', mapId: first.mapId } });
                    } else if (myMaps && myMaps.length > 0) {
                      setSetting({ map: { source: 'custom', customMapId: myMaps[0]!.id } });
                    } else {
                      enterMaps();
                    }
                  }}
                  ariaLabel={t('mapLabel')}
                />
                {settings.map.source === 'official' ? (
                  <select
                    aria-label={t('mapOfficial')}
                    value={settings.map.mapId}
                    onChange={(e) =>
                      setSetting({ map: { source: 'official', mapId: e.target.value } })
                    }
                  >
                    {OFFICIAL_MAPS.map((m) => (
                      <option key={m.mapId} value={m.mapId}>
                        {locale === 'en' ? m.content.meta.nameEn : m.content.meta.nameZh}
                      </option>
                    ))}
                  </select>
                ) : myMaps && myMaps.length > 0 ? (
                  <select
                    aria-label={t('mapCustom')}
                    value={settings.map.customMapId}
                    onChange={(e) =>
                      setSetting({ map: { source: 'custom', customMapId: e.target.value } })
                    }
                  >
                    {myMaps.map((m) => (
                      <option key={m.id} value={m.id}>
                        {locale === 'en' ? m.nameEn : m.nameZh}
                      </option>
                    ))}
                  </select>
                ) : (
                  <button onClick={enterMaps}>
                    <MapIcon size={14} aria-hidden /> {t('mapCreateOne')}
                  </button>
                )}
              </div>
            ) : (
              <span>{mapDisplayName(settings.map, myMaps, room.mapName, locale)}</span>
            )}
          </div>
          {RULE_TOGGLES.map(([key, label, desc]) => (
            <div key={key} className="row between setting-row">
              <span>
                <strong>{t(label)}</strong>
                <br />
                <span className="muted">{t(desc)}</span>
              </span>
              <Switch
                checked={settings[key]}
                onChange={(next) => setSetting({ [key]: next } as Partial<RoomSettings>)}
                label={t(label)}
              />
            </div>
          ))}
          {showEventsPicker && (
            <div className="row between setting-row">
              <span>
                <strong>{t('settingRandomEvents')}</strong>
                <br />
                <span className="muted">{t('settingRandomEventsDesc')}</span>
              </span>
              <Segmented<EventsMode>
                options={[
                  { value: 'off', label: t('eventsMode_off') },
                  { value: 'light', label: t('eventsMode_light') },
                  { value: 'moderate', label: t('eventsMode_moderate') },
                  { value: 'intense', label: t('eventsMode_intense') },
                ]}
                value={settings.eventsMode}
                onChange={(v) => setSetting({ eventsMode: v })}
                ariaLabel={t('settingRandomEvents')}
              />
            </div>
          )}
          <div className="row between setting-row">
            <span>
              <strong>{t('settingTeamMode')}</strong>
              <br />
              <span className="muted">{t('settingTeamModeDesc')}</span>
              {teamCount > 0 && !teamLayoutOk && (
                // The server re-checks this at start; surfacing it here stops the host from
                // discovering an impossible line-up only when they press Start.
                <>
                  <br />
                  <span className="warn">
                    {t('teamNeedsPlayers', {
                      teams: teamCount,
                      players: TEAM_LAYOUTS.filter((l) => l.teamCount === teamCount)
                        .map((l) => l.playerCount)
                        .join(' / '),
                      seated: room.members.length,
                    })}
                  </span>
                </>
              )}
            </span>
            <Segmented<'0' | '2' | '3'>
              options={[
                { value: '0', label: t('teamModeOff') },
                { value: '2', label: t('teamMode2Teams') },
                { value: '3', label: t('teamMode3Teams') },
              ]}
              value={String(teamCount) as '0' | '2' | '3'}
              onChange={(v) => setSetting({ teamCount: Number(v) })}
              ariaLabel={t('settingTeamMode')}
            />
          </div>
          {teamCount > 0 && (
            <div className="row between setting-row">
              <span>
                <strong>{t('settingTeamAssignMode')}</strong>
                <br />
                <span className="muted">{t('settingTeamAssignModeDesc')}</span>
              </span>
              <Segmented<'random' | 'host' | 'self'>
                options={[
                  { value: 'random', label: t('teamAssignModeRandom') },
                  { value: 'host', label: t('teamAssignModeHost') },
                  { value: 'self', label: t('teamAssignModeSelf') },
                ]}
                value={settings.teamAssignMode}
                onChange={(v) => setSetting({ teamAssignMode: v })}
                ariaLabel={t('settingTeamAssignMode')}
              />
            </div>
          )}
          {room.members.filter((m) => !m.isBot).length === 1 && (
            // Only meaningful (and only shown) while the host is the lone human at the table:
            // the started game then waits for them instead of running the per-turn timer.
            <div className="row between setting-row">
              <span>
                <strong>{t('settingSoloWaitForHost')}</strong>
                <br />
                <span className="muted">{t('settingSoloWaitForHostDesc')}</span>
              </span>
              <Switch
                checked={settings.soloWaitForHost}
                onChange={(next) => setSetting({ soloWaitForHost: next })}
                label={t('settingSoloWaitForHost')}
              />
            </div>
          )}
          <div className="row between setting-row">
            <span>
              <strong>{t('allowSpectating')}</strong>
            </span>
            <Switch
              checked={settings.allowSpectating}
              onChange={(next) => setSetting({ allowSpectating: next })}
              label={t('allowSpectating')}
            />
          </div>
          <div className="row between setting-row">
            <strong>{t('roomVisibility')}</strong>
            <Segmented<RoomVisibility>
              options={[
                { value: 'PUBLIC', label: t('visibility_PUBLIC'), icon: Globe },
                { value: 'INVITE_ONLY', label: t('visibility_INVITE_ONLY'), icon: Lock },
              ]}
              value={settings.visibility}
              onChange={(v) => setSetting({ visibility: v })}
              ariaLabel={t('roomVisibility')}
            />
          </div>
        </fieldset>

        {canAddBot && (
          <div className="row bot-controls">
            <span className="muted">{t('addBot')}</span>
            {DIFFICULTIES.map((d) => (
              <button key={d} onClick={() => addBot(d)}>
                {t(`difficulty_${d}`)}
              </button>
            ))}
          </div>
        )}

        <div className="row">
          {me && (
            <button className={me.ready ? 'danger' : 'success'} onClick={toggleReady}>
              {me.ready ? t('cancelReady') : t('markReady')}
            </button>
          )}
          {me && !isHost && (
            <button
              onClick={() => void becomeSpectator()}
              disabled={room.members.length <= 1}
              title={room.members.length <= 1 ? t('spectateDisabledOnlyMember') : undefined}
            >
              {t('watch')}
            </button>
          )}
          {mySpectator && (
            <button
              onClick={() => void becomePlayer()}
              disabled={room.members.length >= room.maxPlayers}
              title={
                room.members.length >= room.maxPlayers ? t('becomePlayerDisabledFull') : undefined
              }
            >
              {t('becomePlayer')}
            </button>
          )}
          {isHost && (
            <button className="primary" disabled={!allReady} onClick={() => void start()}>
              {t('start')}
            </button>
          )}
          <button onClick={onLeaveClick}>{t('leave')}</button>
        </div>

        <p className="muted">
          {room.members.length < 2 ? t('waitingForPlayers') : !allReady ? t('waitingForReady') : ''}
        </p>
        {err && <p className="error">{err}</p>}
        <NotificationStack />
        {kicked && (
          <div className="modal-backdrop" onClick={goHome}>
            <div
              className="modal stack"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="kicked-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="kicked-title">{t('kickedTitle')}</h3>
              <p>{t('kickedBody')}</p>
              <div className="row">
                <button className="primary" onClick={goHome}>
                  {t('kickedAck')}
                </button>
              </div>
            </div>
          </div>
        )}
        {leaveOpen && (
          <ConfirmDialog
            title={t('leaveConfirmTitle')}
            message={t('leaveConfirmBody')}
            onConfirm={confirmLeave}
            onCancel={cancelLeave}
          />
        )}
        {closeOpen && (
          <ConfirmDialog
            title={t('closeRoomConfirmTitle')}
            message={t('closeRoomConfirmBody')}
            onConfirm={confirmClose}
            onCancel={cancelClose}
          />
        )}
        {transferOpen && (
          <ConfirmDialog
            title={t('transferConfirmTitle')}
            message={t('transferConfirmBody')}
            onConfirm={confirmTransfer}
            onCancel={cancelTransfer}
          />
        )}
        {ownerLeaveOpen && (
          <OwnerLeaveDialog
            candidates={otherHumans}
            onTransfer={(id) => void transferAndLeave(id)}
            onClose={() => void closeAndGoHome()}
            onCancel={() => setOwnerLeaveOpen(false)}
          />
        )}
      </div>

      <aside className="comms room-chat-panel">
        <section className="chat-panel">
          <div className="tray-head">
            <h4>{t('chat.heading')}</h4>
          </div>
          <div className="chat-messages">
            {room.chat.length === 0 ? (
              <p className="chat-empty">{t('chat.empty')}</p>
            ) : (
              room.chat.map((c, i) => (
                <div className="chat-msg" key={i}>
                  <span className="chat-author">{chatAuthorName(c.userId)}</span>{' '}
                  <span className="chat-text">{c.text ?? t(chatPresetKey(c.presetId ?? ''))}</span>
                </div>
              ))
            )}
          </div>
          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              const text = chatDraft.trim();
              if (!text) return;
              setChatDraft('');
              track('chat_send', { kind: 'text', context: 'lobby' });
              void guard(api.sendRoomChat(code, { text }));
            }}
          >
            <ChatPresetPicker onSelect={sendChat} />
            <input
              type="text"
              maxLength={2048}
              value={chatDraft}
              placeholder={t('chat.placeholder')}
              onChange={(e) => setChatDraft(e.target.value)}
            />
            <button type="submit" disabled={chatDraft.trim().length === 0}>
              {t('chat.send')}
            </button>
          </form>
        </section>
        {/* Lobby ad: desktop only (≥900px), below the chat input so the interactive form stays
            above it. The lobby has idle dwell time, but is button-dense — the width gate keeps it
            off the cramped stacked phone layout, and it's clear of the Start / chat controls. */}
        <AdSlot placement="room" minWidthPx={900} reserveHeight={250} className="room-ad" />
      </aside>
    </div>
  );
}
