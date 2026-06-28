import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { api, type RoomView } from '../net/rest';
import { connectGame } from '../net/connection';

function UpgradePanel() {
  const { t } = useTranslation();
  const loading = useSession((s) => s.loading);
  const error = useSession((s) => s.error);
  const upgrade = useSession((s) => s.upgrade);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (!open) {
    return (
      <button className="link" onClick={() => setOpen(true)}>
        {t('createAccount')}
      </button>
    );
  }
  return (
    <div className="card stack">
      <p className="muted">{t('upgradeBlurb')}</p>
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
  );
}

export function HomeScreen() {
  const { t } = useTranslation();
  const user = useSession((s) => s.user);
  const enterRoom = useUi((s) => s.enterRoom);
  const enterGame = useUi((s) => s.enterGame);
  const enterTutorial = useUi((s) => s.enterTutorial);

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [publicRooms, setPublicRooms] = useState<RoomView[]>([]);

  // Poll the public-rooms list (refreshes as rooms open/start/close).
  useEffect(() => {
    let active = true;
    const load = () =>
      api
        .getPublicRooms()
        .then((rooms) => active && setPublicRooms(rooms))
        .catch(() => undefined);
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  // Unauthenticated visitors are redirected to /login by the router; render nothing during the
  // brief logout transition before the view switches.
  if (!user) return null;

  const watch = async (roomCode: string) => {
    try {
      const tk = await api.spectate(roomCode);
      connectGame(tk.ticket);
      enterGame(tk.gameId, tk.ticket); // spectator: the snapshot will carry no SelfView
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      enterRoom((await api.createRoom()).code);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const join = async () => {
    setBusy(true);
    setErr(null);
    try {
      enterRoom((await api.joinRoom(code.trim().toUpperCase())).code);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <p>{t('welcome', { name: user.displayName })}</p>
      <button onClick={enterTutorial}>{t('tutorial.title')}</button>
      <div className="card stack">
        <button className="accent" disabled={busy} onClick={() => void create()}>
          {t('createRoom')}
        </button>
        <div className="row">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder={t('enterRoomCode')}
            maxLength={6}
          />
          <button disabled={busy || code.trim().length < 4} onClick={() => void join()}>
            {t('joinRoom')}
          </button>
        </div>
        {err && <p className="error">{err}</p>}
      </div>

      <div className="card stack public-rooms">
        <h3>{t('publicRooms')}</h3>
        {publicRooms.length === 0 && <p className="muted">{t('noPublicRooms')}</p>}
        {publicRooms.map((r) => (
          <div key={r.code} className="row between public-room">
            <span>
              <code className="room-code">{r.code}</code> · {r.members.length}/{r.maxPlayers}
            </span>
            {r.status === 'LOBBY' ? (
              <button onClick={() => enterRoom(r.code)}>{t('joinRoom')}</button>
            ) : (
              <button onClick={() => void watch(r.code)}>{t('watch')}</button>
            )}
          </div>
        ))}
      </div>

      {user.isGuest && <UpgradePanel />}
    </div>
  );
}
