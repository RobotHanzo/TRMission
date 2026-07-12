// The full-screen tutorial route: scope launcher, then each lesson runs a local SandboxSocket
// game through the GLOBAL game store, rendered by the real GameStage with the coachmark +
// spotlight overlay. Fully offline; reachable without an account. Mirrors the web
// TutorialScreen beat-for-beat (gate derivation, dimAll rule, lesson hand-off).
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
import { markTutorialCompleted } from './progress';
import type { ActionGate, Lesson, Scope } from './types';
import type { RootStackParamList } from '../../navigation';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function TutorialLauncher({ onPick, onExit }: { onPick(scope: Scope): void; onExit(): void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.launcher}>
      <View style={styles.launcherCard}>
        <Text style={styles.title}>{t('tutorial.title')}</Text>
        <Text style={styles.muted}>{t('tutorial.intro')}</Text>
        <Pressable
          accessibilityRole="button"
          testID="tut-scope-full"
          style={[styles.btn, styles.btnAccent]}
          onPress={() => onPick('full')}
        >
          <Text style={styles.btnAccentText}>{t('tutorial.full')}</Text>
        </Pressable>
        <Text style={styles.mutedSmall}>{t('tutorial.fullDesc')}</Text>
        <Pressable
          accessibilityRole="button"
          testID="tut-scope-core"
          style={styles.btn}
          onPress={() => onPick('core')}
        >
          <Text style={styles.btnText}>{t('tutorial.quickstart')}</Text>
        </Pressable>
        <Text style={styles.mutedSmall}>{t('tutorial.quickstartDesc')}</Text>
        <Pressable accessibilityRole="button" testID="tut-launcher-exit" onPress={onExit}>
          <Text style={styles.link}>{t('tutorial.exit')}</Text>
        </Pressable>
      </View>
    </View>
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
  const spotlight = beat?.spotlight;
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
      <View style={styles.launcher}>
        <Text style={styles.muted}>{t('game.connecting')}</Text>
      </View>
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

// Light-theme launcher matching the P1 Home surfaces (blue primary, bordered secondary).
const styles = StyleSheet.create({
  launcher: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  launcherCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 16,
    padding: 20,
    gap: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  title: { fontSize: 22, fontWeight: '700' },
  muted: { opacity: 0.75 },
  mutedSmall: { opacity: 0.6, fontSize: 12 },
  btn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ccc',
  },
  btnAccent: { borderWidth: 0, backgroundColor: '#1f6feb' },
  btnText: { fontWeight: '600' },
  btnAccentText: { fontWeight: '700', color: '#fff' },
  link: { textDecorationLine: 'underline', textAlign: 'center', marginTop: 6 },
});
