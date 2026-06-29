// The tutorial coachmark: a polished, non-blocking callout. It renders the beat's narration, an
// optional component specimen (the visual glossary), a progress bar, a connector caret toward the
// spotlighted target, and the right control for the beat mode. It dodges to the top when a target
// would sit under the bottom-anchored bubble.
import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, RotateCcw, X } from 'lucide-react';
import type { Beat, SpecimenSpec } from './types';
import { Specimen } from './Specimens';
import { coachPosition, spotlightCentre, type FlatRect } from './focus';

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
    typeof window !== 'undefined'
      ? coachPosition(spotRects, window.innerWidth, window.innerHeight)
      : 'bottom';
  const sideDocked = pos === 'left' || pos === 'right';
  const progress = total > 0 ? Math.round(((index + 1) / total) * 100) : 0;

  // The caret rides the edge of the coach that faces the spotlight target and points at it: for a
  // top/bottom coach that means a horizontal offset along the facing edge; for a side-docked coach,
  // a vertical offset. Coach-relative so it survives any window size.
  const coachRef = useRef<HTMLDivElement>(null);
  const [caretOffset, setCaretOffset] = useState<{ axis: 'x' | 'y'; px: number } | null>(null);
  useLayoutEffect(() => {
    const centre = spotlightCentre(spotRects);
    const coach = coachRef.current;
    if (!centre || !coach) {
      setCaretOffset(null);
      return;
    }
    const cr = coach.getBoundingClientRect();
    if (cr.width === 0) {
      setCaretOffset(null); // no layout (jsdom) — skip the caret
      return;
    }
    const pad = 24; // ~1.5rem bubble padding, keeps the caret off the rounded corners
    if (sideDocked) {
      setCaretOffset({ axis: 'y', px: Math.max(pad, Math.min(cr.height - pad, centre.y - cr.top)) });
    } else {
      setCaretOffset({ axis: 'x', px: Math.max(pad, Math.min(cr.width - pad, centre.x - cr.left)) });
    }
  }, [spotRects, sideDocked]);

  return (
    <div
      ref={coachRef}
      className="tut-coach"
      data-pos={pos}
      role="dialog"
      aria-label={t('tutorial.title')}
    >
      {caretOffset !== null && (
        <span
          className="tut-coach-caret"
          aria-hidden
          style={caretOffset.axis === 'x' ? { left: `${caretOffset.px}px` } : { top: `${caretOffset.px}px` }}
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
