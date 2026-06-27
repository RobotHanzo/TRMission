import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, X } from 'lucide-react';
import { useUi } from '../store/ui';
import { useSession } from '../store/session';
import { api, type RoomView, type RoomMember, type BotDifficulty } from '../net/rest';
import { connectGame } from '../net/connection';
import { SEAT_COLORS } from '../theme/colors';

const DIFFICULTIES: readonly BotDifficulty[] = ['EASY', 'MEDIUM', 'HARD'];

export function RoomScreen() {
  const { t } = useTranslation();
  const code = useUi((s) => s.roomCode) ?? '';
  const enterGame = useUi((s) => s.enterGame);
  const goHome = useUi((s) => s.goHome);
  const user = useSession((s) => s.user);

  const [room, setRoom] = useState<RoomView | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Poll the room (lobby push is a later enhancement); auto-enter the game when started.
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const r = await api.getRoom(code);
        if (!active) return;
        setRoom(r);
        if (r.status === 'STARTED' && r.gameId) {
          const ticket = await api.getTicket(code);
          if (!active) return;
          connectGame(ticket.ticket);
          enterGame(ticket.gameId, ticket.ticket);
        }
      } catch (e) {
        if (active) setErr((e as Error).message);
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 2000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [code, enterGame]);

  if (!room) return <div className="card">{err ?? t('connecting')}</div>;

  const me = room.members.find((m) => m.userId === user?.id);
  const isHost = room.hostId === user?.id;
  const allReady = room.members.length >= 2 && room.members.every((m) => m.ready);
  const canAddBot = isHost && room.members.length < room.maxPlayers;

  const memberName = (m: RoomMember): string =>
    m.isBot ? t('botName', { level: t(`difficulty_${m.difficulty ?? 'EASY'}`) }) : m.displayName;

  const guard = (p: Promise<RoomView>) => p.then(setRoom).catch((e: Error) => setErr(e.message));

  const toggleReady = () => void guard(api.setReady(code, !me?.ready));
  const addBot = (d: BotDifficulty) => void guard(api.addBot(code, d));
  const removeBot = (botId: string) => void guard(api.removeBot(code, botId));
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
        <button onClick={() => void navigator.clipboard?.writeText(code)}>{t('copyCode')}</button>
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
          </li>
        ))}
      </ul>

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
        <button onClick={toggleReady}>{me?.ready ? t('cancelReady') : t('markReady')}</button>
        {isHost && (
          <button className="primary" disabled={!allReady} onClick={() => void start()}>
            {t('start')}
          </button>
        )}
        <button onClick={() => void leave()}>{t('leave')}</button>
      </div>

      <p className="muted">
        {room.members.length < 2 ? t('waitingForPlayers') : !allReady ? t('waitingForReady') : ''}
      </p>
      {err && <p className="error">{err}</p>}
    </div>
  );
}
