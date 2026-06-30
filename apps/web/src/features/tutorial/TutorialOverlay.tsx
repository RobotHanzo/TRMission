// The tutorial coachmark: a polished, non-blocking callout. It renders the beat's narration, an
// optional component specimen (the visual glossary), a progress bar, a connector caret toward the
// spotlighted target, and the right control for the beat mode. It dodges to the top when a target
// would sit under the bottom-anchored bubble.
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, PartyPopper, RotateCcw, X } from 'lucide-react';
import type { Beat, SpecimenSpec } from './types';
import { Specimen } from './Specimens';
import { coachPosition, spotlightBounds, spotlightCentre, type FlatRect } from './focus';
import { useConfetti } from '../../hooks/useConfetti';

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
  /** Invoked by the finale CTA to take the learner straight into creating their first game. */
  onCreateGame?: (() => void) | undefined;
}

export function TutorialOverlay(props: TutorialOverlayProps) {
  const { t } = useTranslation();
  const { beat, done, index, total, lessonNo, lessonCount, isLastLesson, specimen } = props;
  const spotRects = props.spotRects ?? [];

  // The very end of the tutorial (last lesson complete) gets a celebratory finale + confetti.
  const finished = done && isLastLesson;
  useConfetti(finished);

  // No per-lesson "lesson complete" card: a finished lesson rolls straight into the next one (its
  // final-beat button below becomes "next lesson"). Only the whole-tutorial finale gets its own body.
  const body = finished ? t('tutorial.finalBody') : !done && beat ? t(beat.text) : '';
  // The last beat of a non-final lesson hands off directly to the next lesson.
  const isLastBeat = total > 0 && index === total - 1;
  const pos =
    typeof window !== 'undefined'
      ? coachPosition(spotRects, window.innerWidth, window.innerHeight)
      : 'bottom';
  const sideDocked = pos === 'left' || pos === 'right';
  const progress = total > 0 ? Math.round(((index + 1) / total) * 100) : 0;

  // A side-docked coach sits ADJACENT to its (tall) target rather than at the far screen edge, so it
  // reads as attached to what it highlights — the map or the ticket chooser — clamped on-screen.
  const dockStyle: CSSProperties | undefined = (() => {
    const bounds = spotlightBounds(spotRects);
    if (!sideDocked || !bounds || typeof window === 'undefined') return undefined;
    const vw = window.innerWidth;
    const gap = 16;
    const coachW = Math.min(22 * 16, vw - 24);
    const maxStart = Math.max(gap, vw - coachW - gap);
    if (pos === 'right') {
      const left = Math.max(gap, Math.min(bounds.x + bounds.w + gap, maxStart));
      return { left: `${Math.round(left)}px`, right: 'auto' };
    }
    const right = Math.max(gap, Math.min(vw - bounds.x + gap, maxStart));
    return { right: `${Math.round(right)}px`, left: 'auto' };
  })();

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
      setCaretOffset({
        axis: 'y',
        px: Math.max(pad, Math.min(cr.height - pad, centre.y - cr.top)),
      });
    } else {
      setCaretOffset({
        axis: 'x',
        px: Math.max(pad, Math.min(cr.width - pad, centre.x - cr.left)),
      });
    }
  }, [spotRects, sideDocked]);

  return (
    <div
      ref={coachRef}
      className={finished ? 'tut-coach tut-coach--finale' : 'tut-coach'}
      data-pos={pos}
      style={dockStyle}
      role="dialog"
      aria-label={t('tutorial.title')}
    >
      {caretOffset !== null && (
        <span
          className="tut-coach-caret"
          aria-hidden
          style={
            caretOffset.axis === 'x'
              ? { left: `${caretOffset.px}px` }
              : { top: `${caretOffset.px}px` }
          }
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

      {finished && (
        <div className="tut-finale-badge" aria-hidden>
          <PartyPopper size={34} />
        </div>
      )}
      {finished && <h3 className="tut-finale-title">{t('tutorial.finalTitle')}</h3>}

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
            <button className="accent" onClick={props.onCreateGame ?? props.onExit}>
              {t('tutorial.createGame')}
            </button>
          ) : (
            <button className="accent" onClick={props.onNextLesson}>
              {t('tutorial.nextLesson')} <ChevronRight size={14} />
            </button>
          )
        ) : beat?.mode === 'info' ? (
          isLastBeat && !isLastLesson ? (
            <button className="accent" onClick={props.onNextLesson}>
              {t('tutorial.nextLesson')} <ChevronRight size={14} />
            </button>
          ) : (
            <button className="accent" onClick={props.onAdvance}>
              {t('tutorial.next')} <ChevronRight size={14} />
            </button>
          )
        ) : beat?.mode === 'await' ? (
          <span className="tut-yourturn">{t('tutorial.yourTurn')}</span>
        ) : (
          <span className="tut-auto">{t('tutorial.watching')}</span>
        )}
      </div>
    </div>
  );
}
