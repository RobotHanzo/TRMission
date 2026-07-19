// Per-turn countdown (issue #13), ported from the web TurnCountdown: a depleting bar + remaining
// seconds shown above the trackers for whoever is on the clock. Renders nothing when nobody is
// (bot turn / game over / offline sandbox). Warning-tick + time's-up sounds fire for the local
// player only, driven inside the shared `useTurnCountdown` hook. While the server has the game
// marked inactive (auto-play suspended) the same slot shows a "game paused" banner instead.
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { useTurnCountdown } from '@trm/client-core/game/turnCountdown';
import { useGameStore } from '../../store/game';
import { soundPlayer } from '../../sound/player';

const EMBER = '#ee6b1f';
const DANGER = '#c0392b';

// Module-level (stable identity) so the hook's ticking effect never restarts on re-render.
const SOUNDS = {
  onWarningTick: () => soundPlayer.play('countdownWarning'),
  onLapsed: () => soundPlayer.play('countdownLapsed'),
};

export function TurnCountdown() {
  const { t } = useTranslation();
  const paused = useGameStore((s) => s.paused);
  const cd = useTurnCountdown(SOUNDS);
  if (paused) {
    return (
      <View testID="game-paused" style={styles.wrap} accessibilityRole="text">
        <Text style={styles.pausedText}>{t('gamePausedBanner')}</Text>
      </View>
    );
  }
  if (!cd) return null;

  const frac = cd.totalMs > 0 ? Math.max(0, Math.min(1, cd.remainingMs / cd.totalMs)) : 0;
  const color = cd.warning ? DANGER : EMBER;

  return (
    <View
      testID="turn-countdown"
      style={[styles.wrap, cd.warning && styles.wrapWarning]}
      accessibilityLiveRegion={cd.warning && cd.isSelf ? 'assertive' : 'none'}
      accessibilityLabel={t('turnTimeRemaining', { seconds: cd.seconds })}
    >
      <Text style={[styles.secs, cd.warning && styles.secsWarning]}>{cd.seconds}</Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${frac * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  wrapWarning: { borderColor: DANGER },
  secs: {
    fontSize: 13,
    fontWeight: '700',
    minWidth: 26,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
    color: '#1f2328',
  },
  secsWarning: { color: DANGER },
  pausedText: { fontSize: 13, color: 'rgba(31,35,40,0.65)' },
  track: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.10)',
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 999 },
});
