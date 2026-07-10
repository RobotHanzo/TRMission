// The full-screen tutorial route. The learner first picks a scope (Full vs Quickstart); then each
// lesson runs a local sandbox game driven through the GLOBAL game store (there is no live game on
// this route), reusing the real GameStage with a coachmark overlay on top.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUi } from '../../store/ui';
import { useSession } from '../../store/session';
import { useGame } from '../../store/game';
import { resetToDefaultContent } from '../../game/catalog';
import { GameStage } from '../../screens/GameStage';
import { lessonsForScope } from './curriculum';
import { useScenarioPlayer } from './useScenarioPlayer';
import { TutorialOverlay } from './TutorialOverlay';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useSpotlightRects } from './useSpotlightRects';
import { TutorialSpotlight } from './TutorialSpotlight';
import type { ActionGate, Lesson, Scope } from './types';
import '../../styles/tutorial.css';

function TutorialLauncher({ onPick, onExit }: { onPick(scope: Scope): void; onExit(): void }) {
  const { t } = useTranslation();
  return (
    <div className="tut-launcher">
      <div className="card stack tut-launcher-card">
        <h2>{t('tutorial.title')}</h2>
        <p className="muted">{t('tutorial.intro')}</p>
        <button className="accent" onClick={() => onPick('full')}>
          {t('tutorial.full')}
        </button>
        <p className="muted small">{t('tutorial.fullDesc')}</p>
        <button onClick={() => onPick('core')}>{t('tutorial.quickstart')}</button>
        <p className="muted small">{t('tutorial.quickstartDesc')}</p>
        <button className="link" onClick={onExit}>
          {t('tutorial.exit')}
        </button>
      </div>
    </div>
  );
}

function TutorialRunner({
  lesson,
  lessonNo,
  lessonCount,
  isLast,
  onPrevLesson,
  onNextLesson,
  onExit,
  onCreateGame,
}: {
  lesson: Lesson;
  lessonNo: number;
  lessonCount: number;
  isLast: boolean;
  onPrevLesson(): void;
  onNextLesson(): void;
  onExit(): void;
  onCreateGame(): void;
}) {
  const { t } = useTranslation();
  const player = useScenarioPlayer(lesson, useGame);
  const snapshot = useGame((s) => s.snapshot);
  const reduced = useReducedMotion();
  const beat = player.beat;
  // Once the learner's click on the highlighted route/city opens the payment dialog, redirect the
  // coachmark to IT instead of the map target — the beat itself doesn't finish (and advance) until
  // a payment is actually confirmed, so the learner needs to be told where to look next.
  const [pendingClaim, setPendingClaim] = useState<'route' | 'station' | null>(null);
  useEffect(() => {
    setPendingClaim(null);
  }, [beat?.id]);
  const awaitsPayment =
    !!beat &&
    beat.mode === 'await' &&
    (beat.expect.t === 'CLAIM_ROUTE' || beat.expect.t === 'BUILD_STATION');
  const showPayHint = awaitsPayment && pendingClaim !== null;
  const effectiveBeat =
    showPayHint && beat ? { ...beat, text: 'tutorial.payHint', specimen: undefined } : beat;
  const spotlight = showPayHint
    ? ({ kind: 'hud', selector: '.payment-options' } as const)
    : beat?.spotlight;
  const rects = useSpotlightRects(spotlight);
  const spotlightCities = spotlight?.kind === 'cities' ? spotlight.ids : undefined;
  const frameTarget = beat?.frame ?? null;
  // Gate the HUD to the action the current beat is waiting for. On an `await` beat only the expected
  // affordance is live (so e.g. the draw-tickets button is disabled while we ask for a train-card
  // draw); on any narration / scripted beat — and once the lesson is done — the whole HUD is locked,
  // so the learner can't act ahead of the prompt and strand a later step (no dead ends). A
  // CLAIM_ROUTE/BUILD_STATION gate additionally names the ONE route/city that's interactive —
  // GameStage ignores clicks elsewhere on the map.
  const actionGate: ActionGate = beat && beat.mode === 'await' ? beat.expect : 'locked';
  // Only a whole-board overview (or a beat with no spotlight at all) should dim the entire stage;
  // a beat that names a target must never dim everything while its rect resolves.
  const dimAll = !spotlight || spotlight.kind === 'board';

  if (!snapshot) return <div className="card">{t('connecting')}</div>;

  return (
    <GameStage
      snapshot={snapshot}
      commands={player.commands}
      onLeave={onExit}
      spotlightCities={spotlightCities}
      frameTarget={frameTarget}
      actionGate={actionGate}
      onPendingClaim={setPendingClaim}
      overlay={
        <>
          <TutorialSpotlight rects={rects} reducedMotion={reduced} dimAll={dimAll} />
          <TutorialOverlay
            beat={effectiveBeat}
            done={player.done}
            index={player.index}
            total={player.total}
            lessonTitleKey={lesson.titleKey}
            lessonNo={lessonNo}
            lessonCount={lessonCount}
            isLastLesson={isLast}
            specimen={effectiveBeat?.specimen}
            spotRects={rects}
            onAdvance={player.next}
            onReplay={player.restart}
            onPrevLesson={onPrevLesson}
            onNextLesson={onNextLesson}
            onExit={onExit}
            onCreateGame={onCreateGame}
          />
        </>
      }
    />
  );
}

export default function TutorialScreen() {
  const exit = useUi((s) => s.goHome);
  // The finale CTA leaves the tutorial for home and spotlights the create-game button there (rather
  // than minting a room from inside the tutorial). It also marks the tutorial completed first, so
  // the welcome screen's recommendation dialog stops appearing for this account.
  const createGame = useUi((s) => s.requestCreateGame);
  const completeTutorial = useSession((s) => s.completeTutorial);
  const finishTutorial = () => {
    void completeTutorial();
    createGame();
  };
  const [scope, setScope] = useState<Scope | null>(null);
  const [lessonIdx, setLessonIdx] = useState(0);
  const lessons = useMemo(() => (scope ? lessonsForScope(scope) : []), [scope]);
  // Tutorial always teaches on the Taiwan map — defensive in case the previous screen (a
  // custom-map replay) left a different catalog active.
  useEffect(() => {
    resetToDefaultContent();
  }, []);

  if (!scope) {
    return (
      <TutorialLauncher
        onPick={(s) => {
          setScope(s);
          setLessonIdx(0);
        }}
        onExit={exit}
      />
    );
  }

  const lesson = lessons[lessonIdx];
  if (!lesson) return null;

  return (
    <TutorialRunner
      key={lesson.id}
      lesson={lesson}
      lessonNo={lessonIdx + 1}
      lessonCount={lessons.length}
      isLast={lessonIdx === lessons.length - 1}
      onPrevLesson={() => setLessonIdx((i) => Math.max(0, i - 1))}
      onNextLesson={() => setLessonIdx((i) => Math.min(lessons.length - 1, i + 1))}
      onExit={exit}
      onCreateGame={finishTutorial}
    />
  );
}
