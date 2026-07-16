import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  Bot,
  GraduationCap,
  History,
  Languages,
  Layers,
  Mountain,
  RailSymbol,
  Ticket,
  TrainFront,
  Trophy,
  Users,
} from 'lucide-react';
import { useUi } from '../store/ui';
import { MapBackdrop } from '../components/MapBackdrop';
import { BrandBanner } from '../components/BrandBanner';
import { DiscordGlyph } from '../components/icons/DiscordGlyph';
import { openDiscord } from '../discord';
import { track } from '../lib/analytics';
import '../styles/landing.css';

const HOW_CARDS = [
  { key: 'draw', Icon: Layers },
  { key: 'claim', Icon: TrainFront },
  { key: 'tickets', Icon: Ticket },
] as const;

const FEATURES = [
  { key: 'multiplayer', Icon: Users },
  { key: 'bots', Icon: Bot },
  { key: 'learn', Icon: GraduationCap },
  { key: 'replay', Icon: History },
  { key: 'rules', Icon: Mountain },
  { key: 'theme', Icon: Languages },
] as const;

/** Signed-out `/`: the public front door (issue #17). Explains the game without an account and
 *  offers two "departures": the tutorial (needs no sign-in) and the login screen to play.
 *  Signed-in users never see this — App renders HomeScreen for them on the same view. */
export function LandingScreen() {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const setLocale = useUi((s) => s.setLocale);
  const enterTutorial = useUi((s) => s.enterTutorial);
  const enterLogin = useUi((s) => s.enterLogin);
  const enterPrivacy = useUi((s) => s.enterPrivacy);

  // Landing impression — the top of the acquisition funnel (mirrors welcome_shown).
  useEffect(() => {
    track('landing_shown', {});
  }, []);

  const startTutorial = () => {
    track('landing_cta_click', { target: 'tutorial' });
    enterTutorial();
  };
  const signIn = () => {
    track('landing_cta_click', { target: 'login' });
    enterLogin();
  };
  const switchLocale = () => {
    const next = locale === 'zh-Hant' ? 'en' : 'zh-Hant';
    track('settings_change', { setting: 'locale', value: next });
    setLocale(next);
  };

  return (
    <div className="landing">
      <section className="landing-hero">
        <svg
          className="landing-hero-rails"
          viewBox="0 0 1200 560"
          preserveAspectRatio="none"
          aria-hidden
        >
          <path d="M-20 470 C 260 320, 520 540, 780 380 S 1120 260, 1240 340" />
          <path d="M-20 120 C 240 220, 560 40, 840 170 S 1140 260, 1240 140" />
          <circle cx="300" cy="404" r="5" />
          <circle cx="700" cy="415" r="5" />
          <circle cx="900" cy="150" r="5" />
        </svg>
        <div className="landing-wrap landing-hero-grid">
          <div className="landing-hero-copy">
            <p className="landing-eyebrow">
              <RailSymbol size={14} aria-hidden />
              {t('landing.eyebrow')}
            </p>
            <h1 className="landing-title">{t('landing.title')}</h1>
            <p className="landing-lede">{t('landing.lede')}</p>

            <div
              className="landing-departures"
              role="group"
              aria-label={t('landing.departures.title')}
            >
              {/* The head is a fixed bilingual sign, like the brand banner — not a translation. */}
              <div className="landing-departures-head" aria-hidden>
                <span className="landing-departures-zh">即將發車</span>
                <span className="landing-departures-en">DEPARTURES</span>
              </div>
              <button className="landing-departure" onClick={startTutorial}>
                <span className="landing-departure-dest">
                  {t('landing.departures.tutorialDest')}
                </span>
                <span className="landing-departure-meta">
                  {t('landing.departures.tutorialMeta')}
                </span>
                <span className="landing-departure-status landing-departure-status--go">
                  {t('landing.departures.tutorialStatus')}
                </span>
                <ArrowRight className="landing-departure-arrow" size={18} aria-hidden />
              </button>
              <button className="landing-departure" onClick={signIn}>
                <span className="landing-departure-dest">{t('landing.departures.playDest')}</span>
                <span className="landing-departure-meta">{t('landing.departures.playMeta')}</span>
                <span className="landing-departure-status">
                  {t('landing.departures.playStatus')}
                </span>
                <ArrowRight className="landing-departure-arrow" size={18} aria-hidden />
              </button>
            </div>
          </div>

          {/* The real board (same MapScene the game renders), framed as a station wall map. */}
          <div className="landing-board">
            <MapBackdrop className="landing-board-map" fit="contain" />
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-wrap">
          <h2 className="landing-h2">{t('landing.how.title')}</h2>
          <p className="landing-section-lede">{t('landing.how.lede')}</p>
          <div className="landing-how-grid">
            {HOW_CARDS.map(({ key, Icon }) => (
              <div key={key} className="landing-how-card">
                <span className="landing-how-icon">
                  <Icon size={20} aria-hidden />
                </span>
                <h3>{t(`landing.how.${key}Title`)}</h3>
                <p>{t(`landing.how.${key}Desc`)}</p>
              </div>
            ))}
          </div>
          <p className="landing-scoring">
            <Trophy size={16} aria-hidden />
            {t('landing.how.scoring')}
          </p>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-wrap">
          <h2 className="landing-h2">{t('landing.features.title')}</h2>
          <div className="landing-features-grid">
            {FEATURES.map(({ key, Icon }) => (
              <div key={key} className="landing-feature">
                <span className="landing-feature-icon">
                  <Icon size={17} aria-hidden />
                </span>
                <div>
                  <h3>{t(`landing.features.${key}Title`)}</h3>
                  <p>{t(`landing.features.${key}Desc`)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-wrap">
          <h2 className="landing-h2">{t('landing.account.title')}</h2>
          <ul className="landing-account-points">
            <li>{t('landing.account.play')}</li>
            <li>{t('landing.account.save')}</li>
            <li>{t('landing.account.google')}</li>
          </ul>
          <div className="landing-account-links">
            <button className="link" onClick={enterPrivacy}>
              {t('landing.account.privacyCta')}
            </button>
            <a className="link" href="/account/delete">
              {t('landing.account.deleteCta')}
            </a>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-wrap landing-footer-inner">
          <BrandBanner size="header" />
          <p className="landing-footer-tagline muted">{t('tagline')}</p>
          <div className="landing-footer-links">
            <button onClick={enterPrivacy}>{t('landing.account.privacyCta')}</button>
            <button
              onClick={() => {
                track('discord_click', { source: 'landing' });
                openDiscord();
              }}
            >
              <DiscordGlyph size={15} /> {t('discord')}
            </button>
            <button onClick={switchLocale}>{t('landing.langSwitch')}</button>
          </div>
          <p className="landing-footer-disclaimer muted">{t('landing.footer.disclaimer')}</p>
        </div>
      </footer>
    </div>
  );
}
