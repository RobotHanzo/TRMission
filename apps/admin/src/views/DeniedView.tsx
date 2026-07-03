import { ShieldX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../store/session';

/** A valid game login without a maintainer record lands here — say so plainly. */
export function DeniedView() {
  const { t } = useTranslation();
  const { user, logout } = useSession();

  return (
    <div className="oc-gate">
      <div className="oc-panel oc-gate-card">
        <h1 style={{ fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShieldX size={18} aria-hidden style={{ color: 'var(--oc-signal-stop)' }} />
          {t('denied.title')}
        </h1>
        <p className="oc-muted">{t('denied.body')}</p>
        {user && (
          <p className="oc-mono" style={{ fontSize: 12 }}>
            {user.displayName}
            {user.email ? ` · ${user.email}` : ''}
          </p>
        )}
        <button className="oc-btn" onClick={() => void logout()}>
          {t('denied.logout')}
        </button>
      </div>
    </div>
  );
}
