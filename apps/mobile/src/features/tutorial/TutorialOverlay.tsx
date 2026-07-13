// The tutorial coachmark: a polished, non-blocking callout (ports the web TutorialOverlay). It
// renders the beat's narration, an optional component specimen (the visual glossary), a progress
// bar, a connector caret toward the spotlighted target, and the right control for the beat mode.
// coachPosition dodges it to the top / a side dock when a target would sit under the bottom-
// anchored bubble. Motion mirrors web's tutorial.css: the coach slides+scales in per position
// change (260ms), the specimen/body fade-slide per beat (320/240ms), the progress bar glides
// (360ms), "your turn" pulses (1.6s loop), and the finale badge pops with overshoot — all plain
// RN Animated (the TutorialSpotlight idiom) and all inert under reduced motion.
import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { ChevronRight, PartyPopper, RotateCcw, X } from 'lucide-react-native';
import type { Beat, SpecimenSpec } from './types';
import { Specimen } from './Specimens';
import { coachPosition, spotlightBounds, spotlightCentre, type FlatRect } from './focus';
import { useReducedMotion } from '../../hooks/useReducedMotion';

/** Mount-scoped fade + 6px rise (web `tut-specimen-in`/`tut-body-in`) — remount via `key` per
 *  beat re-fires it, exactly like web's keyed CSS animation. */
function FadeSlideIn({
  durationMs,
  reduced,
  children,
}: PropsWithChildren<{ durationMs: number; reduced: boolean }>) {
  const progress = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) return;
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: durationMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
      isInteraction: false,
    });
    anim.start();
    return () => anim.stop();
  }, [progress, durationMs, reduced]);
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

/** The finale badge's overshoot pop (web `tut-finale-pop`, 480ms, back-out easing). */
function FinalePop({ reduced, children }: PropsWithChildren<{ reduced: boolean }>) {
  const progress = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) return;
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 480,
      easing: Easing.out(Easing.back(2)),
      useNativeDriver: true,
      isInteraction: false,
    });
    anim.start();
    return () => anim.stop();
  }, [progress, reduced]);
  return (
    <Animated.View
      style={{
        opacity: progress.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
        transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

/** The 1.6s "your turn" attention pulse (web `tut-pulse`: opacity 1 → 0.45 → 1, looped). */
function PulseView({ reduced, children }: PropsWithChildren<{ reduced: boolean }>) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.45,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
          isInteraction: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduced]);
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

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
  const reduced = useReducedMotion();

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

  // The caret rides the edge of the coach that faces the spotlight target and points at it. The
  // coach's window rect is captured only when its LAYOUT changes; the caret pixel then derives in
  // render from whatever spotRects the tracking hook hands over — so a camera glide that updates
  // the rects every frame moves the caret smoothly without a native measure round-trip per tick.
  const coachRef = useRef<View>(null);
  const [coachRect, setCoachRect] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const measureCoach = useCallback(() => {
    const coach = coachRef.current;
    if (!coach) return;
    coach.measureInWindow((x, y, w, h) => {
      if (!w || !h) {
        setCoachRect(null); // no layout yet (or a test renderer) — skip the caret
        return;
      }
      setCoachRect((prev) =>
        prev && prev.x === x && prev.y === y && prev.w === w && prev.h === h
          ? prev
          : { x, y, w, h },
      );
    });
  }, []);

  // Entrance / reposition: slide in from the edge the coach docks against + a slight scale-up
  // (web `tut-coach-in` / `tut-coach-in-side`, 260ms). Re-fires whenever the dock position flips.
  const enter = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) {
      enter.setValue(1);
      return;
    }
    enter.setValue(0);
    const anim = Animated.timing(enter, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
      isInteraction: false,
    });
    anim.start();
    return () => anim.stop();
  }, [pos, reduced, enter]);
  const enterShift = enter.interpolate({
    inputRange: [0, 1],
    outputRange: [pos === 'top' ? -12 : pos === 'bottom' ? 12 : 0, 0],
  });
  const enterShiftX = enter.interpolate({
    inputRange: [0, 1],
    outputRange: [pos === 'left' ? 12 : pos === 'right' ? -12 : 0, 0],
  });

  // The progress bar glides between beats instead of jumping (web: width 360ms transition).
  const progressAnim = useRef(new Animated.Value(progress)).current;
  useEffect(() => {
    if (reduced) {
      progressAnim.setValue(progress);
      return;
    }
    const anim = Animated.timing(progressAnim, {
      toValue: progress,
      duration: 360,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // width is a layout prop
      isInteraction: false,
    });
    anim.start();
    return () => anim.stop();
  }, [progress, reduced, progressAnim]);

  const centre = spotlightCentre(spotRects);
  const pad = 24; // keeps the caret off the rounded corners
  const caret: { axis: 'x' | 'y'; px: number } | null =
    centre && coachRect
      ? sideDocked
        ? { axis: 'y', px: Math.max(pad, Math.min(coachRect.h - pad, centre.y - coachRect.y)) }
        : { axis: 'x', px: Math.max(pad, Math.min(coachRect.w - pad, centre.x - coachRect.x)) }
      : null;

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
      <Animated.View
        ref={coachRef}
        onLayout={measureCoach}
        collapsable={false}
        accessibilityViewIsModal={false}
        accessibilityLabel={t('tutorial.title')}
        testID="tut-coach"
        style={[
          styles.coach,
          { width: coachW },
          dock,
          {
            opacity: enter,
            transform: [
              { translateY: enterShift },
              { translateX: enterShiftX },
              { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
            ],
          },
        ]}
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
          <FinalePop reduced={reduced}>
            <View style={styles.finaleBadge}>
              <PartyPopper size={34} color={ACCENT} />
            </View>
          </FinalePop>
        )}
        {finished && <Text style={styles.finaleTitle}>{t('tutorial.finalTitle')}</Text>}

        {!done && specimen && (
          <FadeSlideIn durationMs={320} reduced={reduced} key={beat?.id}>
            <View style={styles.specimen}>
              <Specimen spec={specimen} />
            </View>
          </FadeSlideIn>
        )}

        <FadeSlideIn durationMs={240} reduced={reduced} key={(beat?.id ?? 'done') + ':body'}>
          <Text style={styles.body}>{body}</Text>
        </FadeSlideIn>

        <View style={styles.progressTrack}>
          <Animated.View
            style={[
              styles.progressFill,
              {
                width: progressAnim.interpolate({
                  inputRange: [0, 100],
                  outputRange: ['0%', '100%'],
                }),
              },
            ]}
          />
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
            <PulseView reduced={reduced}>
              <Text testID="tut-yourturn" style={styles.yourTurn}>
                {t('tutorial.yourTurn')}
              </Text>
            </PulseView>
          ) : (
            <Text testID="tut-watching" style={styles.watching}>
              {t('tutorial.watching')}
            </Text>
          )}
        </View>
      </Animated.View>
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
