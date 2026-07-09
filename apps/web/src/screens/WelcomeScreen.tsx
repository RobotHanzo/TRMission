import { useTranslation } from 'react-i18next';
import { CirclePlay, GraduationCap } from 'lucide-react';

interface WelcomeScreenProps {
  name: string;
  onStartTutorial: () => void;
  onContinue: () => void;
}

/** First entry: shown instead of the homepage while an account has 0 completed games. */
export function WelcomeScreen({ name, onStartTutorial, onContinue }: WelcomeScreenProps) {
  const { t } = useTranslation();

  return (
    <div className="welcome">
      <img className="welcome-badge" src="/icon.svg" width={64} height={64} alt="" />
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
            <CirclePlay size={26} aria-hidden />
          </div>
          <h3>{t('home.welcome.skipTitle')}</h3>
          <p>{t('home.welcome.skipDesc')}</p>
          <button className="welcome-option-cta" onClick={onContinue}>
            {t('home.welcome.skipCta')} →
          </button>
        </div>
      </div>

      <p className="welcome-footnote muted">{t('home.welcome.footnote')}</p>
    </div>
  );
}
