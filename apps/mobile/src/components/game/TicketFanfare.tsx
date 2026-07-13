// Full-screen celebration for the local player's own ticket completion (ports the web
// TicketFanfare): the centred ticket card springs in over a seat-colour backdrop with instant
// points, confetti bursting behind it. Skippable by tap, auto-dismissed under the same 7s cap,
// reduced motion → a static banner with no confetti.
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { ticketById } from '../../game/content';
import { seatColor } from '../../theme/colors';
import { rgba } from '../../theme/shade';
import type { Fanfare } from '../../store/animations';
import { Confetti } from '../celebration/Confetti';
import { TicketCard } from './TicketCard';

interface Props {
  fanfare: Fanfare;
  reducedMotion: boolean;
  onDone(): void;
}

export function TicketFanfare({ fanfare, reducedMotion, onDone }: Props) {
  const { t } = useTranslation();
  const def = ticketById.get(fanfare.ticketId);
  const value = def?.value ?? 0;
  const color = seatColor(fanfare.seat);

  const done = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onDoneRef.current();
  }, []);

  const scale = useSharedValue(reducedMotion ? 1 : 0.7);
  const opacity = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => {
    if (!reducedMotion) {
      scale.value = withSpring(1, { damping: 12, stiffness: 180 });
      opacity.value = withTiming(1, { duration: 160 });
    }
    const ttl = reducedMotion ? 1500 : fanfare.long ? 6500 : 4000; // hard cap < 7000ms
    const timer = setTimeout(finish, ttl);
    return () => clearTimeout(timer);
  }, [fanfare, reducedMotion, finish, scale, opacity]);

  const anim = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Pressable
      style={[styles.backdrop, { backgroundColor: rgba(color, 0.32) }]}
      onPress={finish}
      accessibilityRole="alert"
    >
      <Confetti active={!reducedMotion} />
      <Animated.View style={[styles.panel, { borderColor: color }, anim]}>
        <Text style={[styles.title, { color }]}>{t('fanfareTitle')}</Text>
        {fanfare.long && <Text style={styles.sub}>{t('fanfareLong')}</Text>}
        <View style={styles.cardWrap}>
          <TicketCard ticketId={fanfare.ticketId} />
        </View>
        <Text style={styles.value}>
          +{value} {t('points')}
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
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  panel: {
    borderRadius: 16,
    borderWidth: 2,
    backgroundColor: '#fffdf8',
    alignItems: 'center',
    padding: 20,
    gap: 8,
    elevation: 6,
  },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { fontSize: 14, fontWeight: '700', color: '#8a5a00' },
  cardWrap: { marginVertical: 4 },
  value: { fontSize: 18, fontWeight: '800', color: '#1f2328' },
  skip: { fontSize: 12, opacity: 0.55 },
});
