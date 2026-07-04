import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Globe, Lock, Map as MapIcon, UserMinus, X } from 'lucide-react';
import { OFFICIAL_MAPS } from '@trm/map-data';
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
import { Toast } from '../components/Toast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useConfirmAction } from '../hooks/useConfirmAction';
import { Switch } from '../components/ui/Switch';
import { Segmented } from '../components/ui/Segmented';
import type { Locale } from '../store/ui';

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

  const [room, setRoom] = useState<RoomView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [kicked, setKicked] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [myMaps, setMyMaps] = useState<MapSummary[] | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const {
    open: leaveOpen,
    request: requestLeave,
    confirm: confirmLeave,
    cancel: cancelLeave,
  } = useConfirmAction();

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

  const flashToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Poll the room (lobby push is a later enhancement); auto-enter the game when started.
  // `active` doubles as the terminal flag: a terminal outcome clears it, and the interval
  // tears itself down on the next tick so we never re-poll (or re-spam join) after one.
  useEffect(() => {
    if (!code) return; // no room to poll (e.g. mid-navigation after leaving/being kicked)
    let active = true;
    // Whether we have ever been seated here. Once true, vanishing from the roster means the
    // host kicked us — go home instead of silently rejoining on the next tick.
    let wasMember = false;
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
        // progress that we aren't part of can't be joined, so bail home rather than trap.
        // (Existing members of a STARTED game skip this and reconnect via the ticket below —
        // the server rejects join on a started room even for members.)
        if (!r.members.some((m) => m.userId === user?.id)) {
          if (wasMember) {
            // We were seated and have been dropped. In LOBBY that's a host kick — surface a
            // modal and let the player dismiss it home; otherwise just bail home.
            active = false;
            if (r.status === 'LOBBY') setKicked(true);
            else goHome();
            return;
          }
          // A started game we aren't in can't be joined: bail home rather than trap.
          if (r.status !== 'LOBBY') {
            active = false;
            goHome();
            return;
          }
          r = await api.joinRoom(code);
          if (!active) return;
        }
        wasMember = true;
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
  const isHost = room.hostId === user?.id;
  // A shareable link that drops a friend straight into this room (joins on open, after login).
  const roomLink = `${window.location.origin}/room/${code}`;
  const allReady = room.members.length >= 2 && room.members.every((m) => m.ready);
  const canAddBot = isHost && room.members.length < room.maxPlayers;

  const memberName = (m: RoomMember): string =>
    m.isBot ? t('botName', { level: t(`difficulty_${m.difficulty ?? 'EASY'}`) }) : m.displayName;

  const guard = (p: Promise<RoomView>) => p.then(setRoom).catch((e: Error) => setErr(e.message));

  const settings = room.settings;
  const settingsLocked = !isHost || room.status !== 'LOBBY';
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
  const copy = (text: string) => {
    if (!navigator.clipboard) return;
    void Promise.resolve(navigator.clipboard.writeText(text)).then(
      () => flashToast(t('copied')),
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

  return (
    <div className="stack">
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
        <button className={me?.ready ? 'danger' : 'success'} onClick={toggleReady}>
          {me?.ready ? t('cancelReady') : t('markReady')}
        </button>
        {isHost && (
          <button className="primary" disabled={!allReady} onClick={() => void start()}>
            {t('start')}
          </button>
        )}
        <button onClick={() => requestLeave(() => void leave())}>{t('leave')}</button>
      </div>

      <p className="muted">
        {room.members.length < 2 ? t('waitingForPlayers') : !allReady ? t('waitingForReady') : ''}
      </p>
      {err && <p className="error">{err}</p>}
      <Toast message={toast} variant="toast-success" />
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
    </div>
  );
}
