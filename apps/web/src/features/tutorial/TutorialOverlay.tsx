// The tutorial coachmark: a polished, non-blocking callout. It renders the beat's narration, an
// optional component specimen (the visual glossary), a progress bar, a connector caret toward the
// spotlighted target, and the right control for the beat mode. It dodges to the top when a target
// would sit under the bottom-anchored bubble.
import { useTranslation } from 'react-i18next';
import { ChevronRight, RotateCcw, X } from 'lucide-react';
import type { Beat, SpecimenSpec } from './types';
import { Specimen } from './Specimens';
import { coachPosition, type FlatRect } from './focus';

export interface TutorialOverlayProps {
  beat: Beat | null;
  done: boolean;
  index: number;
  total: number;
  lessonTitleKey: string;
  lessonNo: number;
  lessonCount: number;
  isLastLesson: boolean;
  specimen?: SpecimenSpec | undefined;
  spotRects?: FlatRect[] | undefined;
  onAdvance(): void;
  onReplay(): void;
  onPrevLesson(): void;
  onNextLesson(): void;
  onExit(): void;
}

export function TutorialOverlay(props: TutorialOverlayProps) {
  const { t } = useTranslation();
  const { beat, done, index, total, lessonNo, lessonCount, isLastLesson, specimen } = props;
  const spotRects = props.spotRects ?? [];

  const body = done ? t('tutorial.lessonComplete') : beat ? t(beat.text) : '';
  const pos =
    typeof window !== 'undefined' ? coachPosition(spotRects, window.innerHeight) : 'bottom';
  const progress = total > 0 ? Math.round(((index + 1) / total) * 100) : 0;

  // Caret horizontal position: aim at the first target's centre (clamped within the bubble width).
  const caretLeft = spotRects[0] ? spotRects[0].x + spotRects[0].w / 2 : null;

  return (
    <div className="tut-coach" data-pos={pos} role="dialog" aria-label={t('tutorial.title')}>
      {caretLeft !== null && (
        <span
          className="tut-coach-caret"
          aria-hidden
          style={{ left: `clamp(1.5rem, ${Math.round(caretLeft)}px, calc(100% - 1.5rem))` }}
        />
      )}

      <div className="tut-coach-head">
        <span className="tut-coach-chapter">{t(props.lessonTitleKey)}</span>
        <span className="tut-coach-progress-text">
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

      {!done && specimen && (
        <div className="tut-coach-specimen" key={beat?.id}>
          <Specimen spec={specimen} />
        </div>
      )}

      <p className="tut-coach-body" key={(beat?.id ?? 'done') + ':body'}>
        {body}
      </p>

      <div className="tut-progress" aria-hidden>
        <div className="tut-progress-fill" style={{ width: `${progress}%` }} />
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
