// The stacked, self-expiring notification chips — system messages (errors, nudges, confirmations)
// and random-event announcements/bonuses — ported from the web NotificationStack. Copy for the
// announced/bonus variants resolves at render so late roster/locale changes still apply.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAnimationsStore, type NotificationCue } from '../../store/animations';
import { useUi } from '../../store/ui';
import { cityName, routeById } from '../../game/content';
import { eventNameKey } from '../../game/events';

// Must stay >= the exit fade duration so the chip finishes fading before it unmounts.
const EXIT_MS = 200;

// How long each variant stays fully visible before it starts fading out (ports the web table).
const HOLD_MS: Record<NotificationCue['variant'], number> = {
  error: 3000,
  notice: 3500,
  success: 2000,
  announced: 3400,
  bonus: 3400,
};

const CHIP_BG: Record<NotificationCue['variant'], string> = {
  error: '#b3261e',
  notice: '#374151',
  success: '#1a7f37',
  announced: '#8a5a00',
  bonus: '#8a5a00',
};

function NotificationChip({ cue }: { cue: NotificationCue }) {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const removeNotification = useAnimationsStore((s) => s.removeNotification);
  const [exiting, setExiting] = useState(false);
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 180 });
    const holdId = setTimeout(() => setExiting(true), HOLD_MS[cue.variant]);
    return () => clearTimeout(holdId);
  }, [cue.variant, opacity]);

  useEffect(() => {
    if (!exiting) return;
    opacity.value = withTiming(0, { duration: EXIT_MS });
    const exitId = setTimeout(() => removeNotification(cue.id), EXIT_MS);
    return () => clearTimeout(exitId);
  }, [exiting, cue.id, removeNotification, opacity]);

  const anim = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const routeName = (id: string): string => {
    const r = routeById.get(id);
    return r ? `${cityName(r.a as string, locale)}–${cityName(r.b as string, locale)}` : id;
  };

  const text =
    cue.variant === 'announced'
      ? t('log.eventAnnounced', { event: t(eventNameKey(cue.kind)) })
      : cue.variant === 'bonus'
        ? t(`log.eventBonus.${cue.reason}`, {
            points: cue.points,
            city: cue.cityId ? cityName(cue.cityId, locale) : '',
            route: cue.routeId ? routeName(cue.routeId) : '',
          })
        : cue.text;

  return (
    <Animated.View
      style={[styles.chip, { backgroundColor: CHIP_BG[cue.variant] }, anim]}
      accessibilityRole="text"
    >
      <Animated.Text style={styles.chipText}>{text}</Animated.Text>
    </Animated.View>
  );
}

export function NotificationStack() {
  const notifications = useAnimationsStore((s) => s.notifications);
  const insets = useSafeAreaInsets();
  if (notifications.length === 0) return null;
  return (
    <View pointerEvents="none" style={[styles.stack, { top: insets.top + 8 }]}>
      {notifications.map((c) => (
        <NotificationChip key={c.id} cue={c} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 6,
  },
  chip: {
    maxWidth: '88%',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    elevation: 3,
  },
  chipText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
