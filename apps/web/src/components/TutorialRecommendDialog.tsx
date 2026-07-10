import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface TutorialRecommendDialogProps {
  onGoToTutorial: () => void;
  onContinueAnyway: () => void;
}

/** Soft nudge shown from WelcomeScreen's Practice/Jump-in options when the tutorial isn't done yet.
 *  This is a recommendation, not a gate: dismissing (Escape/backdrop click) counts as "continue
 *  anyway", same as clicking that button explicitly. */
export function TutorialRecommendDialog({
  onGoToTutorial,
  onContinueAnyway,
}: TutorialRecommendDialogProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onContinueAnyway();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onContinueAnyway]);

  return (
    <div className="modal-backdrop" onClick={onContinueAnyway}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-recommend-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="tutorial-recommend-title">{t('home.tutorialRecommend.title')}</h3>
        </div>
        <p>{t('home.tutorialRecommend.body')}</p>
        <div className="row">
          <button type="button" onClick={onContinueAnyway}>
            {t('home.tutorialRecommend.continueAnyway')}
          </button>
          <button type="button" className="primary" onClick={onGoToTutorial}>
            {t('home.tutorialRecommend.goToTutorial')}
          </button>
        </div>
      </div>
    </div>
  );
}
