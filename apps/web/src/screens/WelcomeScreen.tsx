import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, CirclePlay, GraduationCap } from 'lucide-react';
import { BrandBanner } from '../components/BrandBanner';
import { DiscordGlyph } from '../components/icons/DiscordGlyph';
import { openDiscord } from '../discord';
import { TutorialRecommendDialog } from '../components/TutorialRecommendDialog';

interface WelcomeScreenProps {
  name: string;
  tutorialCompleted: boolean;
  onStartTutorial: () => void;
  onPractice: () => Promise<void>;
  onContinue: () => void;
}

/** First entry: shown instead of the homepage while an account has 0 completed games. */
export function WelcomeScreen({
  name,
  tutorialCompleted,
  onStartTutorial,
  onPractice,
  onContinue,
}: WelcomeScreenProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when Practice/Jump-in is clicked without the tutorial completed yet — holds which action
  // to run once the recommendation dialog is resolved (either path always runs one of the two).
  const [pendingAction, setPendingAction] = useState<'practice' | 'continue' | null>(null);

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

  const handlePractice = () => {
    if (!tutorialCompleted) {
      setPendingAction('practice');
      return;
    }
    void practice();
  };

  const handleContinue = () => {
    if (!tutorialCompleted) {
      setPendingAction('continue');
      return;
    }
    onContinue();
  };

  const resolvePending = (run: 'practice' | 'continue') => {
    setPendingAction(null);
    if (run === 'practice') void practice();
    else onContinue();
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
          <button className="welcome-option-cta" disabled={busy} onClick={handlePractice}>
            {busy ? t('home.welcome.practiceStarting') : `${t('home.welcome.practiceCta')} →`}
          </button>
        </div>

        <div className="welcome-option">
          <div className="welcome-option-icon">
            <CirclePlay size={26} aria-hidden />
          </div>
          <h3>{t('home.welcome.skipTitle')}</h3>
          <p>{t('home.welcome.skipDesc')}</p>
          <button className="welcome-option-cta" onClick={handleContinue}>
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

      {pendingAction && (
        <TutorialRecommendDialog
          onGoToTutorial={() => {
            setPendingAction(null);
            onStartTutorial();
          }}
          onContinueAnyway={() => resolvePending(pendingAction)}
        />
      )}
    </div>
  );
}
