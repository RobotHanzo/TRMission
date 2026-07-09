import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Globe, Lock, Map as MapIcon, UserMinus, X } from 'lucide-react';
import { OFFICIAL_MAPS } from '@trm/map-data';
import type { EventsMode } from '@trm/shared';
import { useUi } from '../store/ui';
import { useHasFeature, useSession } from '../store/session';
import {
  api,
  ApiError,
  type RoomView,
  type RoomMember,
  type RoomSettings,
  type RoomVisibility,
  type MapSelector,
  type MapSummary,
  type BotDifficulty,
} from '../net/rest';
import { connectGame } from '../net/connection';
import { SEAT_COLORS } from '../theme/colors';
import { useAnimationsStore } from '../store/animations';
import { NotificationStack } from '../components/NotificationStack';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { OwnerLeaveDialog } from '../components/OwnerLeaveDialog';
import { useConfirmAction } from '../hooks/useConfirmAction';
import { Switch } from '../components/ui/Switch';
import { Segmented } from '../components/ui/Segmented';
import type { Locale } from '../store/ui';
import { CHAT_PRESET_IDS, chatPresetKey } from '../game/chatPresets';
import '../styles/game.css';
import '../styles/room.css';

const DIFFICULTIES: readonly BotDifficulty[] = ['EASY', 'MEDIUM', 'HARD'];

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

  // Poll the room (lobby push is a later enhancement); auto-enter the game when started.
  // `active` doubles as the terminal flag: a terminal outcome clears it, and the interval
  // tears itself down on the next tick so we never re-poll (or re-spam join) after one.
  useEffect(() => {
    if (!code) return; // no room to poll (e.g. mid-navigation after leaving/being kicked)
    let active = true;
    // Whether we have ever been present here (seated or spectating). Once true, vanishing
    // from both lists means the host kicked us — go home instead of silently rejoining.
    let wasPresent = false;
    const poll = async () => {
      try {
        let r = await api.getRoom(code);
        if (!active) return;
        if (r.status === 'CLOSED') {
          active = false;
          goHome(); // the room is gone — nothing to wait in or rejoin
          return;
        }
        // A shared link can land a non-member here. Join the lobby once; a game already in
        // progress that we aren't part of can't be joined, so spectate instead if the room
        // allows it, otherwise bail home rather than trap.
        // (Existing members of a STARTED game skip this and reconnect via the ticket below —
        // the server rejects join on a started room even for members.)
        if (!r.members.some((m) => m.userId === user?.id)) {
          // Spectators (arrived watching OR demoted themselves from a seat) are legitimately
          // absent from `members`; only vanishing from BOTH lists is a kick.
          const amSpectator = r.spectators.some((s) => s.userId === user?.id);
          if (wasPresent && !amSpectator) {
            active = false;
            if (r.status === 'LOBBY') setKicked(true);
            else goHome();
            return;
          }
          if (r.status !== 'LOBBY') {
            // A started game we aren't seated in can't be joined — spectate if allowed (this
            // carries a demoted lobby spectator into watching once the game starts); else bail home.
            if (r.status === 'STARTED' && r.gameId && r.settings.allowSpectating) {
              const tk = await api.spectate(code);
              if (!active) return;
              connectGame(tk.ticket);
              enterGame(tk.gameId, tk.ticket);
              return;
            }
            active = false;
            goHome();
            return;
          }
          // A lobby non-member who isn't a spectator joins a seat once; a demoted spectator
          // falls through to keep watching the lobby (never auto-rejoined onto a seat).
          if (!amSpectator) {
            r = await api.joinRoom(code);
            if (!active) return;
          }
        }
        wasPresent = true;
        setRoom(r);
        if (r.status === 'STARTED' && r.gameId) {
          const ticket = await api.getTicket(code);
          if (!active) return;
          connectGame(ticket.ticket);
          enterGame(ticket.gameId, ticket.ticket);
        }
      } catch (e) {
        if (!active) return;
        // A room we can't fetch (deleted, or we're not a member) can't be restored —
        // e.g. landing on a stale /room/:code after a reload. Bail home, don't trap.
        if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
          active = false;
          goHome();
          return;
        }
        // A 400 from join (room full, or the host started the game mid-poll) is terminal —
        // stop polling so we don't re-spam join every 2s; the error card offers a way home.
        if (e instanceof ApiError && e.status === 400) {
          active = false;
          setErr((e as Error).message);
          return;
        }
        setErr((e as Error).message);
      }
    };
    void poll();
    const id = setInterval(() => {
      if (!active) {
        clearInterval(id);
        return;
      }
      void poll();
    }, 2000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [code, user?.id, enterGame, goHome]);

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
  const setSetting = (patch: Partial<RoomSettings>) =>
    void guard(api.updateRoomSettings(code, patch));
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
  const addBot = (d: BotDifficulty) => void guard(api.addBot(code, d));
  const removeBot = (botId: string) => void guard(api.removeBot(code, botId));
  const kick = (userId: string) => void guard(api.kickPlayer(code, userId));
  const sendChat = (presetId: string) => void guard(api.sendRoomChat(code, { presetId }));
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
      connectGame(tk.ticket);
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

        <ul className="member-list">
          {room.members.map((m) => (
            <li key={m.userId}>
              <span
                className="seat-dot"
                style={{ background: SEAT_COLORS[m.seat % 5] ?? '#888' }}
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
          <div className="chat-presets">
            {CHAT_PRESET_IDS.map((id) => (
              <button
                key={id}
                type="button"
                className="chat-preset-btn"
                onClick={() => sendChat(id)}
              >
                {t(chatPresetKey(id))}
              </button>
            ))}
          </div>
          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              const text = chatDraft.trim();
              if (!text) return;
              setChatDraft('');
              void guard(api.sendRoomChat(code, { text }));
            }}
          >
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
      </aside>
    </div>
  );
}
