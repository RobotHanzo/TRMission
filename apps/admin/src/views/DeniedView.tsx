import { ShieldX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../store/session';
import { Copyable } from '../components/CopyButton';

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
        {/* The id and email an owner needs in order to grant access — copyable, since asking
            for access means pasting them somewhere else. */}
        {user && (
          <p className="oc-mono" style={{ fontSize: 12 }}>
            {user.displayName} <Copyable value={user.id} label="ID" muted />
            {user.email && (
              <>
                {' · '}
                <Copyable value={user.email} label={t('users.colEmail')} mono={false} muted />
              </>
            )}
          </p>
        )}
        <button className="oc-btn" onClick={() => void logout()}>
          {t('denied.logout')}
        </button>
      </div>
    </div>
  );
}
