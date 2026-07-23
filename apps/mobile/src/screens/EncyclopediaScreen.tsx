// The rules encyclopedia (ports the web EncyclopediaModal as a full screen): a chapter-grouped
// topic picker up top; below it the topic's title + blurb, then a calm, self-contained board demo
// that auto-plays the lesson's beats with a caption bar — no scrim, no coachmark. The demo runs
// on its OWN isolated sandbox stores (SandboxProvider) driven by the SHARED encyclopedia machine
// (@trm/client-core/tutorial/encyclopedia), so web and mobile can never pace differently.
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react-native';
import { useEncyclopediaDemo } from '@trm/client-core/tutorial/encyclopedia';
import type { RootStackParamList } from '../navigation';
import { encyclopediaEntries } from '../features/tutorial/curriculum';
import type { Lesson } from '../features/tutorial/types';
import { Specimen } from '../features/tutorial/Specimens';
import { SandboxProvider } from '../store/sandboxProvider';
import { useGameStore, useGameStoreApi } from '../store/game';
import { useTheme } from '../theme/useTheme';
import { MutedText } from '../theme/chrome';
import { useGlassHeaderPad } from '../hooks/useGlassHeaderPad';
import { GameStage } from './GameStage';

type Props = NativeStackScreenProps<RootStackParamList, 'Encyclopedia'>;

function EncyclopediaPlayer({ entry }: { entry: Lesson }): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const store = useGameStoreApi(); // the isolated store provided by SandboxProvider
  const { player, playing, setPlaying, stepTo, restartAndPlay } = useEncyclopediaDemo(entry, store);
  const snapshot = useGameStore((s) => s.snapshot);
  const beat = player.beat;
  const spotlight = beat?.spotlight;
  // No dim scrim here; a gentle on-board city glow is the only emphasis a calm clip needs.
  const spotlightCities = spotlight?.kind === 'cities' ? spotlight.ids : undefined;
  const frameTarget = beat?.frame ?? null;

  if (!snapshot) {
    return (
      <View style={styles.center}>
        <MutedText center>{t('game.connecting')}</MutedText>
      </View>
    );
  }

  // When the clip momentarily finishes before looping, hold the last beat's caption + specimen
  // rather than flashing an empty panel (there is no "lesson complete" card here).
  const shownBeat = beat ?? entry.beats[entry.beats.length - 1] ?? null;
  const caption = shownBeat ? t(shownBeat.text) : '';
  const stepNo = Math.min(player.index + 1, player.total);

  return (
    <View style={styles.fill}>
      <View style={styles.stage}>
        <GameStage
          snapshot={snapshot}
          commands={player.commands}
          sandbox
          onLeave={() => {}}
          spotlightCities={spotlightCities}
          frameTarget={frameTarget}
        />
      </View>

      <View style={[styles.caption, { backgroundColor: tokens.surface, borderColor: tokens.line }]}>
        {shownBeat?.specimen && (
          <View key={shownBeat.id} style={styles.specimen}>
            <Specimen spec={shownBeat.specimen} />
          </View>
        )}
        <Text style={[styles.captionText, { color: tokens.ink }]}>{caption}</Text>
        <View style={[styles.progressTrack, { backgroundColor: tokens.line }]}>
          <View
            style={[
              styles.progressFill,
              {
                backgroundColor: tokens.accent,
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('tutorial.prevStep')}
            disabled={player.index <= 0}
            style={[styles.ctlBtn, player.index <= 0 && styles.disabled]}
            onPress={() => stepTo(player.index - 1)}
          >
            <SkipBack size={18} color={tokens.ink} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={playing ? t('tutorial.pause') : t('tutorial.play')}
            style={styles.ctlBtn}
            onPress={() => setPlaying((v) => !v)}
            testID="enc-playpause"
          >
            {playing ? (
              <Pause size={18} color={tokens.ink} />
            ) : (
              <Play size={18} color={tokens.ink} />
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('tutorial.nextStep')}
            disabled={player.index >= player.total - 1}
            style={[styles.ctlBtn, player.index >= player.total - 1 && styles.disabled]}
            onPress={() => stepTo(player.index + 1)}
          >
            <SkipForward size={18} color={tokens.ink} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('tutorial.replay')}
            style={styles.ctlBtn}
            onPress={restartAndPlay}
          >
            <RotateCcw size={16} color={tokens.blue} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export default function EncyclopediaScreen(_props: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const headerPad = useGlassHeaderPad();
  const entries = useMemo(() => encyclopediaEntries(), []);
  const [idx, setIdx] = useState(0);
  // Group entries by chapter, preserving order (web's grouping, rendered as a chip rail).
  const groups = useMemo(() => {
    const m = new Map<number, { entry: (typeof entries)[number]; i: number }[]>();
    entries.forEach((e, i) => {
      const arr = m.get(e.chapter) ?? [];
      arr.push({ entry: e, i });
      m.set(e.chapter, arr);
    });
    return [...m.entries()];
  }, [entries]);

  const entry = entries[idx];
  if (!entry) return <View style={styles.fill} />;

  return (
    <View style={[styles.fill, { backgroundColor: tokens.paper, paddingTop: headerPad }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.picker, { borderColor: tokens.line }]}
        contentContainerStyle={styles.pickerRow}
      >
        {groups.map(([chapter, items]) => (
          <View key={chapter} style={styles.group}>
            <Text style={[styles.groupLabel, { color: tokens.inkSoft }]}>
              {t(`tutorial.chapters.c${chapter}`)}
            </Text>
            {items.map(({ entry: e, i }) => (
              <Pressable
                key={e.id}
                accessibilityRole="button"
                accessibilityState={{ selected: i === idx }}
                onPress={() => setIdx(i)}
                style={[
                  styles.chip,
                  { borderColor: i === idx ? tokens.accent : tokens.line },
                  i === idx && { backgroundColor: `${tokens.accent}22` },
                ]}
              >
                <Text
                  style={[styles.chipText, { color: i === idx ? tokens.accent : tokens.ink }]}
                  numberOfLines={1}
                >
                  {t(e.titleKey)}
                </Text>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>

      <View style={styles.lead}>
        <Text style={[styles.title, { color: tokens.ink }]}>{t(entry.titleKey)}</Text>
        <MutedText>{t(entry.blurbKey)}</MutedText>
      </View>

      {/* Keyed per entry: switching topics rebuilds a fresh isolated sandbox. */}
      <SandboxProvider key={entry.id}>
        <EncyclopediaPlayer entry={entry} />
      </SandboxProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  stage: { flex: 1 },
  picker: { flexGrow: 0, borderBottomWidth: 1 },
  pickerRow: { flexDirection: 'row', gap: 12, padding: 8 },
  group: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  groupLabel: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    minHeight: 36,
    justifyContent: 'center',
    maxWidth: 220,
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  lead: { paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  title: { fontSize: 16, fontWeight: '800' },
  caption: { borderTopWidth: 1, padding: 10, gap: 8 },
  specimen: { alignItems: 'center' },
  captionText: { fontSize: 13, lineHeight: 19 },
  progressTrack: { height: 3, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 3, borderRadius: 2 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  spacer: { flex: 1 },
  stepText: { fontSize: 12, fontVariant: ['tabular-nums'] },
  ctlBtn: {
    padding: 8,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.35 },
});
