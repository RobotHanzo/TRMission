import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { api } from '../net/rest';

export function HomeScreen() {
  const { t } = useTranslation();
  const user = useSession((s) => s.user);
  const loading = useSession((s) => s.loading);
  const error = useSession((s) => s.error);
  const playAsGuest = useSession((s) => s.playAsGuest);
  const enterRoom = useUi((s) => s.enterRoom);

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!user) {
    return (
      <div className="card stack">
        <h1>{t('appName')}</h1>
        <p className="muted">{t('tagline')}</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('guestName')}
          maxLength={24}
        />
        <button className="primary" disabled={loading} onClick={() => void playAsGuest(name)}>
          {t('playAsGuest')}
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

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
    </div>
  );
}
