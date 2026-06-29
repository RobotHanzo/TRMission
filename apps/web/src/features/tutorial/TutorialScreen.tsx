// The full-screen tutorial route. The learner first picks a scope (Full vs Quickstart); then each
// lesson runs a local sandbox game driven through the GLOBAL game store (there is no live game on
// this route), reusing the real GameStage with a coachmark overlay on top.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUi } from '../../store/ui';
import { useGame } from '../../store/game';
import { api } from '../../net/rest';
import { GameStage } from '../../screens/GameStage';
import { lessonsForScope } from './curriculum';
import { useScenarioPlayer } from './useScenarioPlayer';
import { TutorialOverlay } from './TutorialOverlay';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useSpotlightRects } from './useSpotlightRects';
import { TutorialSpotlight } from './TutorialSpotlight';
import type { Lesson, Scope } from './types';
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
  const spotlight = beat?.spotlight;
  const rects = useSpotlightRects(spotlight);
  const spotlightCities = spotlight?.kind === 'cities' ? spotlight.ids : undefined;
  const frameTarget = beat?.frame ?? null;
  // On an `await` beat, gate the HUD to the action the lesson is waiting for (so e.g. the draw-
  // tickets button is disabled while we ask the learner to draw a train card — no dead ends).
  const actionGate = beat && beat.mode === 'await' ? beat.expect : null;
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
      overlay={
        <>
          <TutorialSpotlight rects={rects} reducedMotion={reduced} dimAll={dimAll} />
          <TutorialOverlay
            beat={beat}
            done={player.done}
            index={player.index}
            total={player.total}
            lessonTitleKey={lesson.titleKey}
            lessonNo={lessonNo}
            lessonCount={lessonCount}
            isLastLesson={isLast}
            specimen={beat?.specimen}
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
  const enterRoom = useUi((s) => s.enterRoom);
  const [scope, setScope] = useState<Scope | null>(null);
  const [lessonIdx, setLessonIdx] = useState(0);
  const lessons = useMemo(() => (scope ? lessonsForScope(scope) : []), [scope]);

  // The finale CTA: spin up the learner's first real room, falling back home if the call fails.
  const createGame = () => {
    void api
      .createRoom()
      .then((room) => enterRoom(room.code))
      .catch(() => exit());
  };

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
      onCreateGame={createGame}
    />
  );
}
