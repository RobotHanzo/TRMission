import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LifeBuoy, Mail, MessageSquare } from 'lucide-react';
import { SUPPORT_CATEGORIES, type SupportCategory } from '@trm/shared';
import { SUPPORT_EMAIL } from '@trm/client-core/links';
import { api, ApiError } from '../net/rest';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { DiscordGlyph } from '../components/icons/DiscordGlyph';
import { openDiscord } from '../discord';
import { track } from '../lib/analytics';
import '../styles/support.css';

// Each entry is `support.faq.<key>Q` / `<key>A` — the order below is the reading order on the page,
// cheapest self-serve answer first.
const FAQ_KEYS = ['signin', 'guest', 'delete', 'bug', 'report', 'rules'] as const;

const RELATED_LINKS = [
  { key: 'tutorial', href: '/tutorial' },
  { key: 'deleteAccount', href: '/account/delete' },
  { key: 'privacy', href: '/privacy' },
  { key: 'terms', href: '/terms' },
] as const;

/**
 * The public support page (issue #80). Apple rejected the store listing because the Support URL
 * led to the game rather than to somewhere a user can ask a question — so this page has to answer
 * the common questions on its own AND offer a working contact route, all **without an account**:
 * someone locked out of theirs is exactly the person who needs it.
 *
 * The form posts to `POST /support`, which delivers straight to the maintainers' Discord webhook
 * and stores nothing. When the deployment has no webhook configured (`GET /support/config`), the
 * form is replaced by a notice and the email/Discord channels above it carry the page.
 */
export default function SupportScreen() {
  const { t } = useTranslation();
  const user = useSession((s) => s.user);
  const enterTutorial = useUi((s) => s.enterTutorial);

  // `null` while the probe is in flight — the form renders optimistically rather than flashing
  // an "unavailable" notice at every visitor before the answer arrives.
  const [formEnabled, setFormEnabled] = useState<boolean | null>(null);
  const [category, setCategory] = useState<SupportCategory>('BUG');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .supportConfig()
      .then((c) => {
        if (live) setFormEnabled(c.formEnabled);
      })
      .catch(() => {
        // A failed probe says nothing about the form — leave it rendered and let a real submit
        // report the real problem.
        if (live) setFormEnabled(true);
      });
    return () => {
      live = false;
    };
  }, []);

  // Prefill the reply address from the signed-in account (guests have none).
  useEffect(() => {
    if (user?.email) setEmail((prev) => prev || user.email!);
  }, [user?.email]);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      await api.submitSupport({
        category,
        subject: subject.trim(),
        message: message.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(name.trim() ? { name: name.trim() } : {}),
        platform: 'web',
      });
      track('support_submit', { category });
      setSent(true);
      setSubject('');
      setMessage('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 429)
        setError(t('support.form.errorRateLimited'));
      else if (err instanceof ApiError && err.status === 503) {
        setFormEnabled(false);
        setError(t('support.form.errorUnavailable'));
      } else setError(t('support.form.errorGeneric'));
    } finally {
      setSending(false);
    }
  };

  const joinDiscord = (): void => {
    track('discord_click', { source: 'support' });
    openDiscord();
  };

  return (
    <div className="support stack">
      <header className="support-head">
        <h2 className="support-title">
          <LifeBuoy size={22} aria-hidden />
          {t('support.title')}
        </h2>
        <p className="support-lede">{t('support.lede')}</p>
        <p className="muted">{t('support.responseTime')}</p>
      </header>

      <section className="card stack">
        <h3>{t('support.faq.title')}</h3>
        <dl className="support-faq">
          {FAQ_KEYS.map((key) => (
            <div key={key} className="support-faq-item">
              <dt>{t(`support.faq.${key}Q`)}</dt>
              <dd>{t(`support.faq.${key}A`)}</dd>
            </div>
          ))}
        </dl>
        <nav className="support-links" aria-label={t('support.links.title')}>
          <span className="muted">{t('support.links.title')}:</span>
          {RELATED_LINKS.map(({ key, href }) =>
            key === 'tutorial' ? (
              <button key={key} type="button" className="link" onClick={enterTutorial}>
                {t(`support.links.${key}`)}
              </button>
            ) : (
              <a key={key} className="link" href={href}>
                {t(`support.links.${key}`)}
              </a>
            ),
          )}
        </nav>
      </section>

      <section className="card stack">
        <h3>{t('support.channels.title')}</h3>
        <div className="support-channels">
          <div className="support-channel">
            <span className="support-channel-icon">
              <DiscordGlyph size={18} />
            </span>
            <div>
              <h4>{t('support.channels.discordTitle')}</h4>
              <p className="muted">{t('support.channels.discordBody')}</p>
              <button type="button" className="discord-cta" onClick={joinDiscord}>
                <DiscordGlyph size={16} /> {t('support.channels.discordCta')}
              </button>
            </div>
          </div>
          <div className="support-channel">
            <span className="support-channel-icon">
              <Mail size={18} aria-hidden />
            </span>
            <div>
              <h4>{t('support.channels.emailTitle')}</h4>
              <p className="muted">{t('support.channels.emailBody')}</p>
              <a className="link support-email" href={`mailto:${SUPPORT_EMAIL}`}>
                {SUPPORT_EMAIL}
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="card stack" id="support-form">
        <h3>
          <MessageSquare size={18} aria-hidden /> {t('support.form.title')}
        </h3>

        {formEnabled === false ? (
          <p className="muted">{t('support.form.unavailable')}</p>
        ) : sent ? (
          <div className="stack">
            <p>
              <strong>{t('support.form.sentTitle')}</strong>
            </p>
            <p className="muted">{t('support.form.sentBody')}</p>
            <div className="row">
              <button type="button" onClick={() => setSent(false)}>
                {t('support.form.sendAnother')}
              </button>
            </div>
          </div>
        ) : (
          <form className="stack" onSubmit={(e) => void submit(e)}>
            <p className="muted">{t('support.form.intro')}</p>
            {user && (
              <p className="muted">{t('support.form.signedInAs', { name: user.displayName })}</p>
            )}

            <div className="support-field">
              <label htmlFor="support-category">{t('support.form.category')}</label>
              <select
                id="support-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as SupportCategory)}
                disabled={sending}
              >
                {SUPPORT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`support.category_${c}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className="support-field">
              <label htmlFor="support-subject">{t('support.form.subject')}</label>
              <input
                id="support-subject"
                value={subject}
                maxLength={120}
                required
                placeholder={t('support.form.subjectPlaceholder')}
                onChange={(e) => setSubject(e.target.value)}
                disabled={sending}
              />
            </div>

            <div className="support-field">
              <label htmlFor="support-message">{t('support.form.message')}</label>
              <textarea
                id="support-message"
                value={message}
                rows={6}
                minLength={10}
                maxLength={2000}
                required
                placeholder={t('support.form.messagePlaceholder')}
                onChange={(e) => setMessage(e.target.value)}
                disabled={sending}
              />
            </div>

            <div className="support-field-row">
              <div className="support-field">
                <label htmlFor="support-email">{t('support.form.email')}</label>
                <input
                  id="support-email"
                  type="email"
                  value={email}
                  maxLength={254}
                  autoComplete="email"
                  placeholder={t('support.form.emailPlaceholder')}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={sending}
                />
                <small className="muted">{t('support.form.emailHint')}</small>
              </div>
              <div className="support-field">
                <label htmlFor="support-name">{t('support.form.name')}</label>
                <input
                  id="support-name"
                  value={name}
                  maxLength={80}
                  autoComplete="name"
                  placeholder={t('support.form.namePlaceholder')}
                  onChange={(e) => setName(e.target.value)}
                  disabled={sending}
                />
              </div>
            </div>

            {error && <p className="error">{error}</p>}
            <div className="row">
              <button
                type="submit"
                className="primary"
                disabled={sending || subject.trim().length === 0 || message.trim().length < 10}
              >
                {sending ? t('support.form.sending') : t('support.form.submit')}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
