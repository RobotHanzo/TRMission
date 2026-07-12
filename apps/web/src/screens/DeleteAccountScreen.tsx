import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../net/rest';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';

/**
 * Public account-deletion page. Google Play's Data-safety form requires an HTTPS URL
 * that works without the app; the mobile app's in-app deletion (Apple 5.1.1(v)) calls
 * the same DELETE /auth/me. Anonymous visitors are gated through
 * /login?redirect=/account/delete — that sign-in IS the re-auth; a same-session
 * visitor must additionally re-type their display name below.
 */
export function DeleteAccountScreen() {
  const { t } = useTranslation();
  const user = useSession((s) => s.user);
  const goHome = useUi((s) => s.goHome);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="card stack">
        <h2>{t('deleteAccount.doneTitle')}</h2>
        <p>{t('deleteAccount.doneBody')}</p>
      </div>
    );
  }
  if (!user) return null; // syncFromUrl already gates; belt and braces

  const match = confirmText.trim() === user.displayName;

  const doDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount();
      useSession.setState({ user: null, accessToken: null });
      setDone(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError(t('deleteAccount.maintainerBlocked'));
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack">
      <h2>{t('deleteAccount.title')}</h2>
      <p>{t('deleteAccount.signedInAs', { name: user.displayName })}</p>
      <ul>
        <li>{t('deleteAccount.consequence1')}</li>
        <li>{t('deleteAccount.consequence2')}</li>
        <li>{t('deleteAccount.consequence3')}</li>
        <li>
          <strong>{t('deleteAccount.consequence4')}</strong>
        </li>
      </ul>
      <label htmlFor="delete-confirm-name">
        {t('deleteAccount.typeName', { name: user.displayName })}
      </label>
      <input
        id="delete-confirm-name"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        autoComplete="off"
      />
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button onClick={goHome} disabled={busy}>
          {t('deleteAccount.cancel')}
        </button>
        <button className="danger" disabled={!match || busy} onClick={() => void doDelete()}>
          {t('deleteAccount.confirm')}
        </button>
      </div>
    </div>
  );
}
