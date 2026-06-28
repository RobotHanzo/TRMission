// The tutorial coachmark: a non-blocking callout pinned to the bottom of the board so the learner
// can still interact with the HUD while it guides them. It shows the current beat's narration and
// the right control for the beat mode (Next for info, a "your turn" hint for await, an auto badge
// for a demo), plus lesson navigation.
import { useTranslation } from 'react-i18next';
import { ChevronRight, RotateCcw, X } from 'lucide-react';
import type { Beat } from './types';

export interface TutorialOverlayProps {
  beat: Beat | null;
  done: boolean;
  index: number;
  total: number;
  lessonTitleKey: string;
  lessonNo: number;
  lessonCount: number;
  isLastLesson: boolean;
  onAdvance(): void;
  onReplay(): void;
  onPrevLesson(): void;
  onNextLesson(): void;
  onExit(): void;
}

export function TutorialOverlay(props: TutorialOverlayProps) {
  const { t } = useTranslation();
  const { beat, done, index, total, lessonNo, lessonCount, isLastLesson } = props;

  const body = done ? t('tutorial.lessonComplete') : beat ? t(beat.text) : '';

  return (
    <div className="tut-coach" role="dialog" aria-label={t('tutorial.title')}>
      <div className="tut-coach-head">
        <span className="tut-coach-title">{t(props.lessonTitleKey)}</span>
        <span className="tut-coach-progress">
          {lessonNo}/{lessonCount}
        </span>
        <button
          className="icon-btn tut-coach-x"
          onClick={props.onExit}
          aria-label={t('tutorial.exit')}
        >
          <X size={16} />
        </button>
      </div>

      <p className="tut-coach-body">{body}</p>

      <div className="tut-coach-dots" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={`tut-dot${i <= index ? ' on' : ''}`} />
        ))}
      </div>

      <div className="tut-coach-actions">
        <button className="link" onClick={props.onReplay} title={t('tutorial.replay')}>
          <RotateCcw size={14} /> {t('tutorial.replay')}
        </button>
        <div className="spacer" />
        {lessonNo > 1 && <button onClick={props.onPrevLesson}>{t('tutorial.prevLesson')}</button>}
        {done ? (
          isLastLesson ? (
            <button className="accent" onClick={props.onExit}>
              {t('tutorial.finish')}
            </button>
          ) : (
            <button className="accent" onClick={props.onNextLesson}>
              {t('tutorial.nextLesson')} <ChevronRight size={14} />
            </button>
          )
        ) : beat?.mode === 'info' ? (
          <button className="accent" onClick={props.onAdvance}>
            {t('tutorial.next')} <ChevronRight size={14} />
          </button>
        ) : beat?.mode === 'await' ? (
          <span className="tut-yourturn">{t('tutorial.yourTurn')}</span>
        ) : (
          <span className="tut-auto">{t('tutorial.watching')}</span>
        )}
      </div>
    </div>
  );
}
