// The full-screen tutorial route: scope launcher, then each lesson runs a local SandboxSocket
// game through the GLOBAL game store, rendered by the real GameStage with the coachmark +
// spotlight overlay. Fully offline; reachable without an account. Mirrors the web
// TutorialScreen beat-for-beat (gate derivation, dimAll rule, lesson hand-off).
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useGame } from '../../store/game';
import { resetToDefaultContent } from '../../game/catalog';
import { GameStage } from '../../screens/GameStage';
import { lessonsForScope } from './curriculum';
import { useScenarioPlayer } from './useScenarioPlayer';
import { TutorialOverlay } from './TutorialOverlay';
import { TutorialSpotlight } from './TutorialSpotlight';
import { useSpotlightRects } from './useSpotlightRects';
import { TutorialTargetsProvider } from './targets';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { Card, LinkButton, MutedText, PrimaryButton, Screen, SecondaryButton } from '../../theme/chrome';
import { useTheme } from '../../theme/useTheme';
import { markTutorialCompleted } from './progress';
import type { ActionGate, Lesson, Scope } from './types';
import type { RootStackParamList } from '../../navigation';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function TutorialLauncher({ onPick, onExit }: { onPick(scope: Scope): void; onExit(): void }) {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  return (
    <Screen centered style={styles.launcher}>
      <Card style={styles.launcherCard}>
        <Text style={[styles.title, { color: tokens.ink }]}>{t('tutorial.title')}</Text>
        <MutedText>{t('tutorial.intro')}</MutedText>
        <PrimaryButton
          testID="tut-scope-full"
          title={t('tutorial.full')}
          onPress={() => onPick('full')}
        />
        <MutedText>{t('tutorial.fullDesc')}</MutedText>
        <SecondaryButton
          testID="tut-scope-core"
          title={t('tutorial.quickstart')}
          onPress={() => onPick('core')}
        />
        <MutedText>{t('tutorial.quickstartDesc')}</MutedText>
        <LinkButton testID="tut-launcher-exit" title={t('tutorial.exit')} onPress={onExit} />
      </Card>
    </Screen>
  );
}

function TutorialRunner({
  lesson,
  scope,
  lessonNo,
  lessonCount,
  isLast,
  onPrevLesson,
  onNextLesson,
  onExit,
  onCreateGame,
}: {
  lesson: Lesson;
  scope: Scope;
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
  // Once the learner's tap on the highlighted route/city opens the payment dialog, redirect the
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
  // Web-identical gate: an await beat exposes exactly its affordance; anything else locks the HUD.
  const actionGate: ActionGate = beat && beat.mode === 'await' ? beat.expect : 'locked';
  // Only a whole-board overview (or no spotlight at all) dims the entire stage; a named target
  // must never dim everything while its rect resolves.
  const dimAll = !spotlight || spotlight.kind === 'board';

  // Whole-tutorial completion → persist (offline, fire-and-forget).
  useEffect(() => {
    if (player.done && isLast) void markTutorialCompleted(scope);
  }, [player.done, isLast, scope]);

  if (!snapshot) {
    return (
      <Screen centered style={styles.launcher}>
        <MutedText>{t('game.connecting')}</MutedText>
      </Screen>
    );
  }

  return (
    <GameStage
      snapshot={snapshot}
      commands={player.commands}
      onLeave={onExit}
      sandbox
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
  const navigation = useNavigation<Nav>();
  const [scope, setScope] = useState<Scope | null>(null);
  const [lessonIdx, setLessonIdx] = useState(0);
  const lessons = useMemo(() => (scope ? lessonsForScope(scope) : []), [scope]);
  // Back-first exit: the Tutorial route is registered in BOTH the authed and unauthed stacks
  // (no-account reachability), and only the authed one has a Home screen to navigate to.
  const exit = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Home');
  };

  // The tutorial always teaches on the bundled Taiwan map — defensive against a previous
  // screen (a custom-map game) having left another catalog active. Same as web.
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
    <TutorialTargetsProvider>
      <TutorialRunner
        key={lesson.id}
        lesson={lesson}
        scope={scope}
        lessonNo={lessonIdx + 1}
        lessonCount={lessons.length}
        isLast={lessonIdx === lessons.length - 1}
        onPrevLesson={() => setLessonIdx((i) => Math.max(0, i - 1))}
        onNextLesson={() => setLessonIdx((i) => Math.min(lessons.length - 1, i + 1))}
        onExit={exit}
        onCreateGame={exit} // Home is the create-game surface on mobile; land the learner there
      />
    </TutorialTargetsProvider>
  );
}

// Themed launcher (Screen/Card/*Button chrome primitives) matching the P1 Home surfaces.
const styles = StyleSheet.create({
  launcher: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  launcherCard: { width: '100%', maxWidth: 360 },
  title: { fontSize: 22, fontWeight: '700' },
});
