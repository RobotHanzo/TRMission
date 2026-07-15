import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, ChevronRight, CirclePlus, GraduationCap, RailSymbol } from 'lucide-react';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { useAnimationsStore } from '../store/animations';
import { api, type RoomView } from '../net/rest';
import { connectGame } from '../net/connection';
import { track } from '../lib/analytics';
import { WelcomeScreen } from './WelcomeScreen';

/** The guest sidebar notice: a one-line nudge that expands into the upgrade form in place. */
function GuestUpgradeCard() {
  const { t } = useTranslation();
  const loading = useSession((s) => s.loading);
  const error = useSession((s) => s.error);
  const upgrade = useSession((s) => s.upgrade);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="home-guest-card">
      <p>{t('home.guestNotice')}</p>
      {!open ? (
        <button className="link home-guest-link" onClick={() => setOpen(true)}>
          {t('createAccount')}
        </button>
      ) : (
        <div className="stack">
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
      )}
    </div>
  );
}

export function HomeScreen() {
  const { t } = useTranslation();
  const user = useSession((s) => s.user);
  const enterRoom = useUi((s) => s.enterRoom);
  const enterGame = useUi((s) => s.enterGame);
  const enterTutorial = useUi((s) => s.enterTutorial);
  const openEncyclopedia = useUi((s) => s.setEncyclopediaOpen);
  const homeFocus = useUi((s) => s.homeFocus);
  const clearHomeFocus = useUi((s) => s.clearHomeFocus);
  const setPractice = useUi((s) => s.setPractice);
  const pushNotification = useAnimationsStore((s) => s.pushNotification);

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [publicRooms, setPublicRooms] = useState<RoomView[]>([]);
  const [myRooms, setMyRooms] = useState<RoomView[]>([]);
  const createBtnRef = useRef<HTMLButtonElement>(null);
  // First-entry gate: null while unknown, true for a brand-new account (0 completed games as a
  // player) — shown instead of the homepage until the user starts the tutorial or continues past it.
  const [showWelcome, setShowWelcome] = useState<boolean | null>(null);

  // Consume a one-shot focus request (e.g. arriving from the tutorial finale): bring the create-game
  // button into view, focus it, and let the pulse highlight clear once the request is dropped.
  useEffect(() => {
    if (homeFocus !== 'create') return;
    const btn = createBtnRef.current;
    if (btn) {
      btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
      btn.focus();
    }
  }, [homeFocus]);

  // Poll the public-rooms list and the user's own active rooms (both refresh as rooms
  // open/start/close; the latter powers the hero's rejoin banner).
  useEffect(() => {
    let active = true;
    const load = () => {
      api
        .getPublicRooms()
        .then((rooms) => active && setPublicRooms(rooms))
        .catch(() => undefined);
      api
        .getMyRooms()
        .then((rooms) => active && setMyRooms(rooms))
        .catch(() => undefined);
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  // A game only counts once finished, so an unfinished first game still gates on the welcome
  // screen — spectated-only games don't count either.
  useEffect(() => {
    if (!user) return;
    let active = true;
    api
      .history()
      .then((rows) => active && setShowWelcome(!rows.some((r) => r.role === 'player')))
      .catch(() => active && setShowWelcome(false));
    return () => {
      active = false;
    };
  }, [user]);

  // Signed-out visitors get LandingScreen from App on this same view; render nothing during
  // the brief logout transition before that swap happens.
  if (!user) return null;

  // Don't flash the homepage (or its rooms-list fetch) while it's still unknown whether this is
  // a brand-new account.
  if (showWelcome === null) return null;
  // Welcome-screen "practice with bots": one server call spins up a started game vs bots, then we
  // navigate exactly like watch() does (roomCode + /room/:code URL before entering the game view).
  const startPractice = async () => {
    setPractice(true);
    track('practice_start', {});
    const tk = await api.startPractice();
    connectGame(tk.ticket, { roomCode: tk.code });
    enterRoom(tk.code);
    enterGame(tk.gameId, tk.ticket);
  };
  if (showWelcome) {
    return (
      <WelcomeScreen
        name={user.displayName}
        tutorialCompleted={user.tutorialCompleted}
        onStartTutorial={enterTutorial}
        onPractice={startPractice}
        onContinue={() => setShowWelcome(false)}
      />
    );
  }

  // Most recent first from the server — the first entry is the rejoin target.
  const activeRoom = myRooms[0];

  const watch = async (roomCode: string) => {
    try {
      const tk = await api.spectate(roomCode);
      track('spectate_start', {});
      connectGame(tk.ticket, { roomCode, spectator: true });
      // enterRoom first: it sets roomCode + pushes /room/:code, which GameScreen's roster fetch
      // (real names instead of "P{seat+1}") and a reload's syncFromUrl both depend on.
      enterRoom(roomCode);
      enterGame(tk.gameId, tk.ticket); // spectator: the snapshot will carry no SelfView
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const room = await api.createRoom();
      setPractice(false);
      track('room_create', {});
      enterRoom(room.code);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const join = async () => {
    setBusy(true);
    setErr(null);
    setPractice(false);
    try {
      const target = code.trim().toUpperCase();
      const r = await api.getRoom(target);
      if (r.status === 'STARTED' && r.settings.allowSpectating) {
        const tk = await api.spectate(target);
        track('spectate_start', {});
        connectGame(tk.ticket, { roomCode: target, spectator: true });
        // Same as watch() above: establish roomCode + the /room/:code URL before entering.
        enterRoom(target);
        enterGame(tk.gameId, tk.ticket);
      } else {
        const joined = await api.joinRoom(target);
        // A full room seats the joiner as a spectator instead of rejecting the join — tell
        // them once, since they expected a seat.
        if (
          !joined.members.some((m) => m.userId === user.id) &&
          joined.spectators.some((s) => s.userId === user.id)
        ) {
          pushNotification({ variant: 'notice', text: t('fullRoomSpectateNotice') });
        }
        track('room_join', { via: 'code' });
        enterRoom(joined.code);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="home">
      <section className="home-hero">
        <svg
          className="home-hero-rails"
          viewBox="0 0 920 220"
          preserveAspectRatio="none"
          aria-hidden
        >
          <path d="M-20 180 C 200 60, 340 220, 560 90 S 900 40, 960 120" />
          <path d="M-20 40 C 160 140, 420 -20, 620 110 S 880 200, 960 60" />
          <circle cx="200" cy="86" r="5" />
          <circle cx="470" cy="140" r="5" />
          <circle cx="700" cy="70" r="5" />
        </svg>
        <div className="home-hero-top">
          <div>
            {activeRoom && (
              <p className="home-hero-eyebrow">
                {t('home.activeRoomEyebrow')}{' '}
                <span className="home-hero-code">{activeRoom.code}</span>
                {` · ${activeRoom.members.length}/${activeRoom.maxPlayers}`}
              </p>
            )}
            <h1 className="home-hero-title">{t('home.welcomeBack', { name: user.displayName })}</h1>
            <p className="home-hero-tagline">{t('tagline')}</p>
          </div>
          {activeRoom && (
            <button
              className="home-rejoin"
              onClick={() => {
                track('room_join', { via: 'rejoin' });
                enterRoom(activeRoom.code);
              }}
            >
              {t('home.rejoin', { code: activeRoom.code })} →
            </button>
          )}
        </div>
        <div className="home-hero-actions">
          <button
            ref={createBtnRef}
            className={
              homeFocus === 'create' ? 'accent home-create tut-focus-pulse' : 'accent home-create'
            }
            disabled={busy}
            onClick={() => {
              clearHomeFocus();
              void create();
            }}
            onBlur={() => homeFocus === 'create' && clearHomeFocus()}
          >
            <CirclePlus size={18} aria-hidden />
            {t('createRoom')}
          </button>
          <div className="home-join">
            <RailSymbol size={16} aria-hidden className="home-join-icon" />
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder={t('enterRoomCode')}
              aria-label={t('enterRoomCode')}
              maxLength={6}
            />
            <button disabled={busy || code.trim().length < 4} onClick={() => void join()}>
              {t('home.join')}
            </button>
          </div>
        </div>
        {err && <p className="home-hero-error">{err}</p>}
      </section>

      <div className="home-grid">
        <section className="home-rooms">
          <header className="home-rooms-head">
            <strong>{t('publicRooms')}</strong>
            <span className="muted">{t('home.roomsCount', { n: publicRooms.length })}</span>
          </header>
          {publicRooms.length === 0 && (
            <p className="home-rooms-empty muted">{t('noPublicRooms')}</p>
          )}
          {publicRooms.map((r) => (
            <div key={r.code} className="home-room-row">
              <div className="home-room-info">
                <code className="room-code">{r.code}</code>
                <span className="muted">
                  {t('home.playersCount', { n: r.members.length, max: r.maxPlayers })}
                </span>
                <span className={r.status === 'LOBBY' ? 'home-pill home-pill--lobby' : 'home-pill'}>
                  {r.status === 'LOBBY' ? t('home.statusLobby') : t('home.statusPlaying')}
                </span>
              </div>
              {r.status === 'LOBBY' ? (
                <button
                  onClick={() => {
                    track('room_join', { via: 'public_list' });
                    enterRoom(r.code);
                  }}
                >
                  {t('home.join')}
                </button>
              ) : (
                <button className="home-watch" onClick={() => void watch(r.code)}>
                  {t('watch')}
                </button>
              )}
            </div>
          ))}
        </section>

        <aside className="home-side">
          <button
            className="home-side-card"
            onClick={() => {
              track('encyclopedia_open', {});
              openEncyclopedia(true);
            }}
          >
            <span className="home-side-icon home-side-icon--accent">
              <BookOpen size={18} aria-hidden />
            </span>
            <span className="home-side-text">
              <strong>{t('tutorial.open')}</strong>
              <span>{t('home.encyclopediaDesc')}</span>
            </span>
            <span className="home-side-chevron">
              <ChevronRight size={14} aria-hidden />
            </span>
          </button>
          <button className="home-side-card" onClick={enterTutorial}>
            <span className="home-side-icon">
              <GraduationCap size={18} aria-hidden />
            </span>
            <span className="home-side-text">
              <strong>{t('home.tutorialTitle')}</strong>
              <span>{t('home.tutorialDesc')}</span>
            </span>
            <span className="home-side-chevron">
              <ChevronRight size={14} aria-hidden />
            </span>
          </button>
          {user.isGuest && <GuestUpgradeCard />}
        </aside>
      </div>
    </div>
  );
}
