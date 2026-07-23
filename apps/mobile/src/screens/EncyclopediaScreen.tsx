// The rules encyclopedia, restructured for phones as two honest surfaces instead of six stacked
// chrome bands. The CONTENTS page is a station-departure-board index: one numbered row per topic
// (ordinal ── title ── dashed timetable leader ── step count), the app's timetable voice. Opening
// a topic switches to the PLAYER: a full-bleed board demo (GameStage in `demo` mode — no leave
// chip, no turn banner, dock collapsed until a beat references a HUD panel) with just two floating
// layers of reading UI — a topic strip up top (contents / prev / next) and a subtitle card at the
// bottom (specimen + caption + progress + transport). The demo still runs on its OWN isolated
// sandbox stores (SandboxProvider) driven by the SHARED encyclopedia machine
// (@trm/client-core/tutorial/encyclopedia), so web and mobile can never pace differently.
import { useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  BackHandler,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  ChevronRight,
  List,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
} from 'lucide-react-native';
import { useEncyclopediaDemo } from '@trm/client-core/tutorial/encyclopedia';
import { encyclopediaEntries } from '../features/tutorial/curriculum';
import type { Beat, Lesson } from '../features/tutorial/types';
import { Specimen } from '../features/tutorial/Specimens';
import { SandboxProvider } from '../store/sandboxProvider';
import { useGameStore, useGameStoreApi } from '../store/game';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useTheme } from '../theme/useTheme';
import { MutedText } from '../theme/chrome';
import { CountPill, DashedLeader } from '../theme/gameChrome';
import { useTabBarPad } from '../hooks/useTabBarPad';
import { GameStage } from './GameStage';
import type { DockTabKey } from './stageLayout';

/** The dock tab a narration beat "talks about": an explicit HUD spotlight names its panel; an
 *  await beat performing a market action implies the draw tab. Anything else returns null and the
 *  demo dock stays tucked down to its strip — map beats own the whole window. */
const HUD_SELECTOR_TAB: Record<string, DockTabKey> = {
  '.market': 'draw',
  '.hand': 'hand',
  '.tickets': 'missions',
  '.trackers': 'players',
};
function dockTabForBeat(beat: Beat | null): DockTabKey | null {
  if (!beat) return null;
  if (beat.spotlight?.kind === 'hud') return HUD_SELECTOR_TAB[beat.spotlight.selector] ?? null;
  if (beat.mode === 'await') {
    const expect = beat.expect.t;
    if (
      expect === 'DRAW_ANY' ||
      expect === 'DRAW_BLIND' ||
      expect === 'DRAW_FACEUP' ||
      expect === 'DRAW_TICKETS'
    )
      return 'draw';
  }
  return null;
}

/** Mount-scoped fade + 6px rise for the caption/specimen (the TutorialOverlay idiom — remount
 *  via `key` per beat re-fires it); inert under reduced motion. */
function FadeIn({ reduced, children }: PropsWithChildren<{ reduced: boolean }>) {
  const progress = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) return;
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
      isInteraction: false,
    });
    anim.start();
    return () => anim.stop();
  }, [progress, reduced]);
  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

/** The contents page: a departure-board list — every topic a numbered line with the timetable
 *  leader running out to its step count. Ordinals are list positions (the reading order), not the
 *  curriculum's internal chapter numbers. */
function EncyclopediaIndex({
  entries,
  onOpen,
}: {
  entries: Lesson[];
  onOpen(index: number): void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarPad = useTabBarPad();
  return (
    <View style={[styles.fill, { backgroundColor: tokens.paper }]}>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[
          styles.indexContent,
          { paddingTop: insets.top + 24, paddingBottom: tabBarPad + 24 },
        ]}
      >
        <View style={styles.indexColumn}>
          <Text style={[styles.indexTitle, { color: tokens.ink }]}>{t('tutorial.open')}</Text>
          <MutedText>{t('tutorial.indexHint')}</MutedText>
          <View
            style={[
              styles.toc,
              {
                backgroundColor: tokens.surface,
                borderColor: tokens.line,
                shadowColor: tokens.ink,
              },
            ]}
          >
            {entries.map((e, i) => (
              <Pressable
                key={e.id}
                testID={`enc-topic-${e.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${t(e.titleKey)} — ${t(e.blurbKey)}`}
                onPress={() => onOpen(i)}
                style={({ pressed }) => [
                  styles.tocRow,
                  i > 0 && { borderTopWidth: 1, borderTopColor: tokens.line },
                  pressed && { backgroundColor: tokens.surface2 },
                ]}
              >
                <View style={[styles.ordinal, { backgroundColor: tokens.surface2 }]}>
                  <Text style={[styles.ordinalText, { color: tokens.inkSoft }]}>
                    {String(i + 1).padStart(2, '0')}
                  </Text>
                </View>
                <View style={styles.tocBody}>
                  <View style={styles.tocHead}>
                    <Text style={[styles.tocTitle, { color: tokens.ink }]} numberOfLines={1}>
                      {t(e.titleKey)}
                    </Text>
                    <DashedLeader color={tokens.line} />
                    <CountPill value={t('tutorial.steps', { n: e.beats.length })} />
                  </View>
                  <Text style={[styles.tocBlurb, { color: tokens.inkSoft }]} numberOfLines={2}>
                    {t(e.blurbKey)}
                  </Text>
                </View>
                <ChevronRight size={16} color={tokens.inkSoft} />
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

/** A 44pt round ghost control (transport + topic strip). */
function RoundBtn({
  label,
  onPress,
  disabled,
  testID,
  children,
}: PropsWithChildren<{
  label: string;
  onPress?: (() => void) | undefined;
  disabled?: boolean | undefined;
  testID?: string | undefined;
}>): React.JSX.Element {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={disabled ? { disabled: true } : undefined}
      disabled={disabled}
      {...(testID ? { testID } : {})}
      onPress={onPress}
      style={({ pressed }) => [
        styles.roundBtn,
        {
          backgroundColor: pressed ? tokens.surface2 : tokens.surface,
          borderColor: tokens.line,
          shadowColor: tokens.ink,
        },
        disabled && styles.disabled,
      ]}
    >
      {children}
    </Pressable>
  );
}

function EncyclopediaPlayer({
  entry,
  ordinal,
  count,
  onBack,
  onPrev,
  onNext,
}: {
  entry: Lesson;
  ordinal: number;
  count: number;
  onBack(): void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarPad = useTabBarPad();
  const reduced = useReducedMotion();
  const store = useGameStoreApi(); // the isolated store provided by SandboxProvider
  const { player, playing, setPlaying, stepTo, restartAndPlay } = useEncyclopediaDemo(entry, store);
  const snapshot = useGameStore((s) => s.snapshot);
  const beat = player.beat;
  const spotlight = beat?.spotlight;
  // No dim scrim here; a gentle on-board city glow is the only emphasis a calm clip needs.
  const spotlightCities = spotlight?.kind === 'cities' ? spotlight.ids : undefined;
  const frameTarget = beat?.frame ?? null;

  // When the clip momentarily finishes before looping, hold the last beat's caption + specimen
  // rather than flashing an empty panel (there is no "lesson complete" card here).
  const shownBeat = beat ?? entry.beats[entry.beats.length - 1] ?? null;
  const caption = shownBeat ? t(shownBeat.text) : '';
  const stepNo = Math.min(player.index + 1, player.total);

  return (
    <View style={[styles.fill, { backgroundColor: tokens.paper, paddingBottom: tabBarPad }]}>
      <View style={styles.fill}>
        {snapshot ? (
          <GameStage
            snapshot={snapshot}
            commands={player.commands}
            sandbox
            demo
            demoDock={dockTabForBeat(beat)}
            // The demo performs every move itself; the viewer's board/market taps stay inert.
            actionGate="locked"
            onLeave={onBack}
            spotlightCities={spotlightCities}
            frameTarget={frameTarget}
          />
        ) : (
          <View style={styles.center}>
            <MutedText center>{t('game.connecting')}</MutedText>
          </View>
        )}

        {/* The topic strip floats over the board's top edge: contents pill + prev/next topic. */}
        <View style={[styles.topicRow, { top: insets.top + 8 }]} pointerEvents="box-none">
          <RoundBtn
            testID="enc-prev-topic"
            label={t('tutorial.prevLesson')}
            disabled={!onPrev}
            onPress={onPrev ?? undefined}
          >
            <ChevronLeft size={20} color={tokens.ink} />
          </RoundBtn>
          <Pressable
            testID="enc-contents"
            accessibilityRole="button"
            accessibilityLabel={t('tutorial.contents')}
            onPress={onBack}
            style={({ pressed }) => [
              styles.topicPill,
              {
                backgroundColor: pressed ? tokens.surface2 : tokens.surface,
                borderColor: tokens.line,
                shadowColor: tokens.ink,
              },
            ]}
          >
            <List size={16} color={tokens.inkSoft} />
            <Text style={[styles.topicTitle, { color: tokens.ink }]} numberOfLines={1}>
              {t(entry.titleKey)}
            </Text>
            <Text style={[styles.topicPos, { color: tokens.inkSoft }]}>
              {ordinal}/{count}
            </Text>
          </Pressable>
          <RoundBtn
            testID="enc-next-topic"
            label={t('tutorial.nextLesson')}
            disabled={!onNext}
            onPress={onNext ?? undefined}
          >
            <ChevronRight size={20} color={tokens.ink} />
          </RoundBtn>
        </View>
      </View>

      {/* The subtitle card: narration + progress + transport, one calm surface under the stage. */}
      <View style={styles.captionWrap}>
        <View
          style={[
            styles.captionCard,
            { backgroundColor: tokens.surface, borderColor: tokens.line, shadowColor: tokens.ink },
          ]}
        >
          {shownBeat?.specimen && (
            <FadeIn key={`${shownBeat.id}:spec`} reduced={reduced}>
              <View style={styles.specimen}>
                <Specimen spec={shownBeat.specimen} />
              </View>
            </FadeIn>
          )}
          <FadeIn key={`${shownBeat?.id ?? 'end'}:cap`} reduced={reduced}>
            <Text style={[styles.captionText, { color: tokens.ink }]}>{caption}</Text>
          </FadeIn>
          <View style={[styles.progressTrack, { backgroundColor: tokens.line }]}>
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: tokens.ember,
                  width: `${player.total ? (stepNo / player.total) * 100 : 0}%`,
                },
              ]}
            />
          </View>
          <View style={styles.controls}>
            <Text style={[styles.stepText, { color: tokens.inkSoft }]}>
              {`${stepNo} / ${player.total}`}
            </Text>
            <View style={styles.spacer} />
            <RoundBtn
              label={t('tutorial.prevStep')}
              disabled={player.index <= 0}
              onPress={() => stepTo(player.index - 1)}
            >
              <SkipBack size={18} color={tokens.ink} />
            </RoundBtn>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={playing ? t('tutorial.pause') : t('tutorial.play')}
              testID="enc-playpause"
              onPress={() => setPlaying((v) => !v)}
              style={({ pressed }) => [
                styles.playBtn,
                { backgroundColor: tokens.ember, shadowColor: tokens.ink },
                pressed && styles.pressed,
              ]}
            >
              {playing ? <Pause size={22} color="#fff" /> : <Play size={22} color="#fff" />}
            </Pressable>
            <RoundBtn
              label={t('tutorial.nextStep')}
              disabled={player.index >= player.total - 1}
              onPress={() => stepTo(player.index + 1)}
            >
              <SkipForward size={18} color={tokens.ink} />
            </RoundBtn>
            <View style={styles.spacer} />
            <RoundBtn label={t('tutorial.replay')} onPress={restartAndPlay}>
              <RotateCcw size={16} color={tokens.blue} />
            </RoundBtn>
          </View>
        </View>
      </View>
    </View>
  );
}

export default function EncyclopediaScreen(): React.JSX.Element {
  const entries = useMemo(() => encyclopediaEntries(), []);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const inPlayer = openIdx !== null;

  // Android hardware back closes the player back to the contents, instead of leaving the tab.
  useEffect(() => {
    if (!inPlayer) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOpenIdx(null);
      return true;
    });
    return () => sub.remove();
  }, [inPlayer]);

  const entry = openIdx === null ? undefined : entries[openIdx];
  if (openIdx === null || !entry) {
    return <EncyclopediaIndex entries={entries} onOpen={setOpenIdx} />;
  }
  return (
    // Keyed per entry: switching topics rebuilds a fresh isolated sandbox.
    <SandboxProvider key={entry.id}>
      <EncyclopediaPlayer
        entry={entry}
        ordinal={openIdx + 1}
        count={entries.length}
        onBack={() => setOpenIdx(null)}
        onPrev={openIdx > 0 ? () => setOpenIdx(openIdx - 1) : null}
        onNext={openIdx < entries.length - 1 ? () => setOpenIdx(openIdx + 1) : null}
      />
    </SandboxProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },

  // Contents page.
  indexContent: { paddingHorizontal: 16 },
  indexColumn: { width: '100%', maxWidth: 640, alignSelf: 'center', gap: 6 },
  indexTitle: { fontSize: 26, fontWeight: '800' },
  toc: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  tocRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  ordinal: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ordinalText: { fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  tocBody: { flex: 1, gap: 3 },
  tocHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tocTitle: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  tocBlurb: { fontSize: 12, lineHeight: 17 },

  // Player: topic strip.
  topicRow: {
    position: 'absolute',
    left: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  topicPill: {
    flex: 1,
    minHeight: 44,
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  topicTitle: { fontSize: 14, fontWeight: '700', flexShrink: 1 },
  topicPos: { fontSize: 12, fontVariant: ['tabular-nums'] },

  // Player: subtitle card.
  captionWrap: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10, alignItems: 'center' },
  captionCard: {
    width: '100%',
    maxWidth: 640,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    gap: 8,
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  specimen: { alignItems: 'center' },
  captionText: { fontSize: 13, lineHeight: 19, minHeight: 38 },
  progressTrack: { height: 3, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 3, borderRadius: 2 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  spacer: { flex: 1 },
  stepText: { fontSize: 12, fontVariant: ['tabular-nums'] },
  roundBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.1,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  playBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.85 },
});
