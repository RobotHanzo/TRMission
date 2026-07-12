// The final-round alarm (ports the web EndgameWarning): a full-screen warning that pops the moment
// a player runs their trains down and triggers the endgame. Skippable via tap / auto-timeout,
// reduced-motion aware — urgent red instead of celebratory seat colour.
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { TriangleAlert } from 'lucide-react-native';
import type { EndgameCue } from '../../store/animations';

interface Props {
  cue: EndgameCue;
  reducedMotion: boolean;
  onDone(): void;
}

export function EndgameWarning({ cue, reducedMotion, onDone }: Props) {
  const { t } = useTranslation();

  const done = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onDoneRef.current();
  }, []);

  const scale = useSharedValue(reducedMotion ? 1 : 0.8);
  const opacity = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => {
    if (!reducedMotion) {
      scale.value = withSpring(1, { damping: 14, stiffness: 220 });
      opacity.value = withTiming(1, { duration: 180 });
    }
    const timer = setTimeout(finish, reducedMotion ? 2000 : 4200);
    return () => clearTimeout(timer);
  }, [reducedMotion, finish, scale, opacity]);

  const anim = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Pressable style={styles.backdrop} onPress={finish} accessibilityRole="alert">
      <Animated.View style={[styles.panel, anim]}>
        <View style={styles.icon}>
          <TriangleAlert color="#fff" size={30} />
        </View>
        <Text style={styles.title}>{t('endgameTitle')}</Text>
        <Text style={styles.sub}>
          {cue.deadlock
            ? t('endgameByDeadlock')
            : cue.triggeredByYou
              ? t('endgameByYou')
              : t('endgameByOther')}
        </Text>
        <Text style={styles.note}>
          {cue.deadlock ? t('endgameNoteDeadlock') : t('endgameNote')}
        </Text>
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
    backgroundColor: 'rgba(20,10,8,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  panel: {
    maxWidth: 380,
    borderRadius: 16,
    backgroundColor: '#7f1d1d',
    alignItems: 'center',
    padding: 22,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  icon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: '#fff', fontSize: 22, fontWeight: '800' },
  sub: { color: '#fecaca', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  note: { color: 'rgba(255,255,255,0.85)', fontSize: 13, textAlign: 'center' },
  skip: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 6 },
});
