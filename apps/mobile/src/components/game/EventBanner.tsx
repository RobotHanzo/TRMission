// The random-event START banner (ports the web EventBanner): a prominent but skippable card
// announcing a newly-live event. Modelled on EndgameWarning — dismissible by tap / auto-timeout
// and reduced-motion aware. All copy resolves from the event `kind` at render.
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { EventBannerCue } from '../../store/animations';
import { eventDescKey, eventNameKey } from '../../game/events';

interface Props {
  cue: EventBannerCue;
  reducedMotion: boolean;
  onDone(): void;
}

export function EventBanner({ cue, reducedMotion, onDone }: Props) {
  const { t } = useTranslation();

  const done = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onDoneRef.current();
  }, []);

  const scale = useSharedValue(reducedMotion ? 1 : 0.85);
  const opacity = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => {
    if (!reducedMotion) {
      scale.value = withSpring(1, { damping: 15, stiffness: 220 });
      opacity.value = withTiming(1, { duration: 180 });
    }
    const timer = setTimeout(finish, reducedMotion ? 1800 : 3400);
    return () => clearTimeout(timer);
  }, [reducedMotion, finish, scale, opacity]);

  const anim = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Pressable style={styles.backdrop} onPress={finish} accessibilityRole="alert">
      <Animated.View style={[styles.panel, anim]}>
        <Text style={styles.eyebrow}>{t('events.eyebrow')}</Text>
        <Text style={styles.title}>{t(eventNameKey(cue.kind))}</Text>
        <Text style={styles.desc}>{t(eventDescKey(cue.kind))}</Text>
        <Text style={styles.skip}>{t('skip')}</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(10,14,20,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  panel: {
    maxWidth: 380,
    borderRadius: 16,
    backgroundColor: '#0f3d5c',
    alignItems: 'center',
    padding: 22,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  eyebrow: {
    color: '#facc6b',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  title: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  desc: { color: 'rgba(255,255,255,0.88)', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  skip: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 6 },
});
