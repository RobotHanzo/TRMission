import { useState, type FormEvent } from 'react';
import { TrainFront } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../store/session';

export function LoginView() {
  const { t } = useTranslation();
  const { login, loading, error } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!loading) void login(email, password);
  };

  return (
    <div className="oc-gate">
      <div className="oc-panel oc-gate-card">
        <div className="oc-brand">
          <TrainFront size={24} aria-hidden />
          <div className="text">
            <span className="name">{t('brand.name')}</span>
            <span className="sub">{t('brand.sub')}</span>
          </div>
        </div>
        <form onSubmit={submit}>
          <input
            type="email"
            autoComplete="email"
            placeholder={t('login.email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            autoComplete="current-password"
            placeholder={t('login.password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <div className="error">{error}</div>}
          <button className="oc-btn primary" type="submit" disabled={loading}>
            {t('login.submit')}
          </button>
        </form>
        <p className="alt">
          {t('login.oauthHint')} <a href="/login">{t('login.openMain')}</a>
        </p>
      </div>
    </div>
  );
}
