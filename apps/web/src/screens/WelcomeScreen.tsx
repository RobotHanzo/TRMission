import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, CirclePlay, GraduationCap } from 'lucide-react';
import { BrandBanner } from '../components/BrandBanner';
import { DiscordGlyph } from '../components/icons/DiscordGlyph';
import { openDiscord } from '../discord';

interface WelcomeScreenProps {
  name: string;
  onStartTutorial: () => void;
  onPractice: () => Promise<void>;
  onContinue: () => void;
}

/** First entry: shown instead of the homepage while an account has 0 completed games. */
export function WelcomeScreen({
  name,
  onStartTutorial,
  onPractice,
  onContinue,
}: WelcomeScreenProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "Practice" is the one option that fires an async API call; the other two are plain
  // navigations. On success the view switches to the game and this screen unmounts, so we only
  // ever clear `busy` on failure.
  const practice = async () => {
    setBusy(true);
    setError(null);
    try {
      await onPractice();
    } catch {
      setError(t('home.welcome.practiceError'));
      setBusy(false);
    }
  };

  return (
    <div className="welcome">
      <BrandBanner size="hero" className="welcome-brand" />
      <h1 className="welcome-title">{t('home.welcome.title', { name })}</h1>
      <p className="welcome-subtitle">{t('home.welcome.subtitle')}</p>

      <div className="welcome-options">
        <div className="welcome-option welcome-option--primary">
          <div className="welcome-option-icon welcome-option-icon--primary">
            <GraduationCap size={26} aria-hidden />
          </div>
          <h3>{t('home.welcome.learnTitle')}</h3>
          <p>{t('home.welcome.learnDesc')}</p>
          <button className="primary welcome-option-cta" onClick={onStartTutorial}>
            {t('home.welcome.learnCta')} →
          </button>
        </div>

        <div className="welcome-option">
          <div className="welcome-option-icon">
            <Bot size={26} aria-hidden />
          </div>
          <h3>{t('home.welcome.practiceTitle')}</h3>
          <p>{t('home.welcome.practiceDesc')}</p>
          <button className="welcome-option-cta" disabled={busy} onClick={() => void practice()}>
            {busy ? t('home.welcome.practiceStarting') : `${t('home.welcome.practiceCta')} →`}
          </button>
        </div>

        <div className="welcome-option">
          <div className="welcome-option-icon">
            <CirclePlay size={26} aria-hidden />
          </div>
          <h3>{t('home.welcome.skipTitle')}</h3>
          <p>{t('home.welcome.skipDesc')}</p>
          <button className="welcome-option-cta" onClick={onContinue}>
            {t('home.welcome.skipCta')} →
          </button>
        </div>
      </div>

      <div className="welcome-discord">
        <button className="discord-cta" onClick={openDiscord}>
          <DiscordGlyph size={18} /> {t('home.welcome.discordCta')}
        </button>
      </div>

      {error && <p className="welcome-error error">{error}</p>}
      <p className="welcome-footnote muted">{t('home.welcome.footnote')}</p>
    </div>
  );
}
