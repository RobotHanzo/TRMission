// The tutorial coachmark: a polished, non-blocking callout (ports the web TutorialOverlay). It
// renders the beat's narration, an optional component specimen (the visual glossary), a progress
// bar, a connector caret toward the spotlighted target, and the right control for the beat mode.
// coachPosition dodges it to the top / a side dock when a target would sit under the bottom-
// anchored bubble. (The web's finale confetti has no native counterpart — the badge carries it.)
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ChevronRight, PartyPopper, RotateCcw, X } from 'lucide-react-native';
import type { Beat, SpecimenSpec } from './types';
import { Specimen } from './Specimens';
import { coachPosition, spotlightBounds, spotlightCentre, type FlatRect } from './focus';

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

const GAP = 16;
const CARET = 12;
const ACCENT = '#ee6b1f';
const SURFACE = '#22262c';
const INK = '#e9ecf1';
const INK_DIM = 'rgba(233, 236, 241, 0.65)';

export function TutorialOverlay(props: TutorialOverlayProps) {
  const { t } = useTranslation();
  const { beat, done, index, total, lessonNo, lessonCount, isLastLesson, specimen } = props;
  const spotRects = props.spotRects ?? [];
  const { width, height } = useWindowDimensions();

  // The very end of the tutorial (last lesson complete) gets the celebratory finale card.
  const finished = done && isLastLesson;

  // No per-lesson "lesson complete" card: a finished lesson rolls straight into the next one (its
  // final-beat button becomes "next lesson"). Only the whole-tutorial finale gets its own body.
  const body = finished ? t('tutorial.finalBody') : !done && beat ? t(beat.text) : '';
  // The last beat of a non-final lesson hands off directly to the next lesson.
  const isLastBeat = total > 0 && index === total - 1;
  const pos = coachPosition(spotRects, width, height);
  const sideDocked = pos === 'left' || pos === 'right';
  const progress = total > 0 ? Math.round(((index + 1) / total) * 100) : 0;
  const coachW = Math.min(22 * 16, width - 24);

  // A side-docked coach sits ADJACENT to its (tall) target rather than at the far screen edge, so
  // it reads as attached to what it highlights — clamped on-screen (web dockStyle, arithmetic 1:1).
  const dock = (() => {
    if (!sideDocked) return null;
    const bounds = spotlightBounds(spotRects);
    if (!bounds) return null;
    const maxStart = Math.max(GAP, width - coachW - GAP);
    if (pos === 'right') {
      return {
        marginLeft: Math.round(Math.max(GAP, Math.min(bounds.x + bounds.w + GAP, maxStart))),
      };
    }
    return { marginRight: Math.round(Math.max(GAP, Math.min(width - bounds.x + GAP, maxStart))) };
  })();

  // The caret rides the edge of the coach that faces the spotlight target and points at it —
  // coach-relative (via measureInWindow) so it survives any window size. Hidden until laid out.
  const coachRef = useRef<View>(null);
  const [caret, setCaret] = useState<{ axis: 'x' | 'y'; px: number } | null>(null);
  // Keyed on the rect VALUES: the measuring hook hands over a fresh array every poll.
  const spotKey = JSON.stringify(spotRects);
  const measureCaret = useCallback(() => {
    const centre = spotlightCentre(spotRects);
    const coach = coachRef.current;
    if (!centre || !coach) {
      setCaret(null);
      return;
    }
    coach.measureInWindow((x, y, w, h) => {
      if (!w || !h) {
        setCaret(null); // no layout yet (or a test renderer) — skip the caret
        return;
      }
      const pad = 24; // keeps the caret off the rounded corners
      if (sideDocked) {
        setCaret({ axis: 'y', px: Math.max(pad, Math.min(h - pad, centre.y - y)) });
      } else {
        setCaret({ axis: 'x', px: Math.max(pad, Math.min(w - pad, centre.x - x)) });
      }
    });
    // `spotKey` stands in for `spotRects` (fresh identity each poll would loop the effect).
  }, [spotKey, sideDocked]);
  useEffect(measureCaret, [measureCaret]);

  const caretStyle =
    caret &&
    (caret.axis === 'x'
      ? [
          styles.caret,
          pos === 'top' ? styles.caretBottomEdge : styles.caretTopEdge,
          { left: caret.px - CARET / 2 },
        ]
      : [
          styles.caret,
          pos === 'left' ? styles.caretRightEdge : styles.caretLeftEdge,
          { top: caret.px - CARET / 2 },
        ]);

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, wrapperStyles[pos]]}>
      <View
        ref={coachRef}
        onLayout={measureCaret}
        collapsable={false}
        accessibilityViewIsModal={false}
        accessibilityLabel={t('tutorial.title')}
        testID="tut-coach"
        style={[styles.coach, { width: coachW }, dock]}
      >
        {caretStyle && <View style={caretStyle} />}

        <View style={styles.head}>
          <Text style={styles.chapter} numberOfLines={1}>
            {t(props.lessonTitleKey)}
          </Text>
          <Text style={styles.progressText}>
            {lessonNo}/{lessonCount}
          </Text>
          <Pressable
            testID="tut-exit"
            accessibilityRole="button"
            accessibilityLabel={t('tutorial.exit')}
            hitSlop={12}
            onPress={props.onExit}
            style={({ pressed }) => [styles.exitBtn, pressed && styles.pressed]}
          >
            <X size={16} color={INK_DIM} />
          </Pressable>
        </View>

        {finished && (
          <View style={styles.finaleBadge}>
            <PartyPopper size={34} color={ACCENT} />
          </View>
        )}
        {finished && <Text style={styles.finaleTitle}>{t('tutorial.finalTitle')}</Text>}

        {!done && specimen && (
          <View style={styles.specimen} key={beat?.id}>
            <Specimen spec={specimen} />
          </View>
        )}

        <Text style={styles.body} key={(beat?.id ?? 'done') + ':body'}>
          {body}
        </Text>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>

        <View style={styles.actions}>
          <Pressable
            testID="tut-replay"
            accessibilityRole="button"
            onPress={props.onReplay}
            style={({ pressed }) => [styles.linkBtn, pressed && styles.pressed]}
          >
            <RotateCcw size={14} color={INK_DIM} />
            <Text style={styles.linkText}>{t('tutorial.replay')}</Text>
          </Pressable>
          <View style={styles.spacer} />
          {lessonNo > 1 && (
            <Pressable
              testID="tut-prev-lesson"
              accessibilityRole="button"
              onPress={props.onPrevLesson}
              style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
            >
              <Text style={styles.btnText}>{t('tutorial.prevLesson')}</Text>
            </Pressable>
          )}
          {done ? (
            isLastLesson ? (
              <Pressable
                testID="tut-finale-cta"
                accessibilityRole="button"
                onPress={props.onCreateGame ?? props.onExit}
                style={({ pressed }) => [styles.btn, styles.accentBtn, pressed && styles.pressed]}
              >
                <Text style={styles.accentText}>{t('tutorial.createGame')}</Text>
              </Pressable>
            ) : (
              <Pressable
                testID="tut-next-lesson"
                accessibilityRole="button"
                onPress={props.onNextLesson}
                style={({ pressed }) => [styles.btn, styles.accentBtn, pressed && styles.pressed]}
              >
                <Text style={styles.accentText}>{t('tutorial.nextLesson')}</Text>
                <ChevronRight size={14} color="#fff" />
              </Pressable>
            )
          ) : beat?.mode === 'info' ? (
            isLastBeat && !isLastLesson ? (
              <Pressable
                testID="tut-next-lesson"
                accessibilityRole="button"
                onPress={props.onNextLesson}
                style={({ pressed }) => [styles.btn, styles.accentBtn, pressed && styles.pressed]}
              >
                <Text style={styles.accentText}>{t('tutorial.nextLesson')}</Text>
                <ChevronRight size={14} color="#fff" />
              </Pressable>
            ) : (
              <Pressable
                testID="tut-next"
                accessibilityRole="button"
                onPress={props.onAdvance}
                style={({ pressed }) => [styles.btn, styles.accentBtn, pressed && styles.pressed]}
              >
                <Text style={styles.accentText}>{t('tutorial.next')}</Text>
                <ChevronRight size={14} color="#fff" />
              </Pressable>
            )
          ) : beat?.mode === 'await' ? (
            <Text testID="tut-yourturn" style={styles.yourTurn}>
              {t('tutorial.yourTurn')}
            </Text>
          ) : (
            <Text testID="tut-watching" style={styles.watching}>
              {t('tutorial.watching')}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

// One flex recipe per coach position (the wrapper is the absolute-filled, touch-transparent zone).
const wrapperStyles = StyleSheet.create({
  bottom: { justifyContent: 'flex-end', alignItems: 'center', padding: 12 },
  top: { justifyContent: 'flex-start', alignItems: 'center', padding: 12 },
  left: { justifyContent: 'center', alignItems: 'flex-end', padding: 12 },
  right: { justifyContent: 'center', alignItems: 'flex-start', padding: 12 },
});

const styles = StyleSheet.create({
  coach: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  caret: {
    position: 'absolute',
    width: CARET,
    height: CARET,
    backgroundColor: SURFACE,
    transform: [{ rotate: '45deg' }],
  },
  caretTopEdge: { top: -CARET / 2 },
  caretBottomEdge: { bottom: -CARET / 2 },
  caretLeftEdge: { left: -CARET / 2 },
  caretRightEdge: { right: -CARET / 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chapter: { flex: 1, color: INK, fontSize: 13, fontWeight: '700' },
  progressText: { color: INK_DIM, fontSize: 12, fontVariant: ['tabular-nums'] },
  exitBtn: { padding: 2 },
  finaleBadge: { alignItems: 'center' },
  finaleTitle: { color: INK, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  specimen: { backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 10, padding: 8 },
  body: { color: INK, fontSize: 14, lineHeight: 20 },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.14)' },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: ACCENT },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40 },
  linkText: { color: INK_DIM, fontSize: 12 },
  spacer: { flex: 1 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: 12,
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  btnText: { color: INK, fontSize: 13, fontWeight: '600' },
  accentBtn: { backgroundColor: ACCENT },
  accentText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  yourTurn: { color: ACCENT, fontSize: 13, fontWeight: '700' },
  watching: { color: INK_DIM, fontSize: 13 },
  pressed: { opacity: 0.75 },
});
