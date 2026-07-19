// Per-turn countdown (issue #13), ported from the web TurnCountdown: a depleting bar + remaining
// seconds shown for whoever is on the clock. Renders nothing when nobody is (bot turn / game over /
// offline sandbox). Warning-tick + time's-up sounds fire for the local player only, driven inside
// the shared `useTurnCountdown` hook — so the stage must mount this exactly ONCE (compact floats it
// over the board; the pane tiers put it atop the players panel). While the server has the game
// marked inactive (auto-play suspended) the same slot shows a "game paused" banner instead.
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { useTurnCountdown } from '@trm/client-core/game/turnCountdown';
import { useGameStore } from '../../store/game';
import { soundPlayer } from '../../sound/player';
import { RADIUS, useTheme } from '../../theme/useTheme';
import { rgba } from '../../theme/shade';

// Module-level (stable identity) so the hook's ticking effect never restarts on re-render.
const SOUNDS = {
  onWarningTick: () => soundPlayer.play('countdownWarning'),
  onLapsed: () => soundPlayer.play('countdownLapsed'),
};

export function TurnCountdown({ floating }: { floating?: boolean | undefined }) {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const paused = useGameStore((s) => s.paused);
  const cd = useTurnCountdown(SOUNDS);
  // Floating over the board the chip is a solid surface card; in a rail panel it stays a quiet wash.
  const shellStyle = floating
    ? [
        styles.wrap,
        styles.floating,
        { backgroundColor: tokens.surface, borderColor: tokens.line, shadowColor: tokens.ink },
      ]
    : [styles.wrap, { backgroundColor: rgba(tokens.ink, 0.04), borderColor: tokens.line }];
  if (paused) {
    return (
      <View testID="game-paused" style={shellStyle} accessibilityRole="text">
        <Text style={[styles.pausedText, { color: tokens.inkSoft }]}>
          {t('gamePausedBanner')}
        </Text>
      </View>
    );
  }
  if (!cd) return null;

  const frac = cd.totalMs > 0 ? Math.max(0, Math.min(1, cd.remainingMs / cd.totalMs)) : 0;
  const color = cd.warning ? tokens.danger : tokens.ember;

  return (
    <View
      testID="turn-countdown"
      style={[...shellStyle, cd.warning && { borderColor: tokens.danger }]}
      accessibilityLiveRegion={cd.warning && cd.isSelf ? 'assertive' : 'none'}
      accessibilityLabel={t('turnTimeRemaining', { seconds: cd.seconds })}
    >
      <Text
        style={[styles.secs, { color: cd.warning ? tokens.danger : tokens.ink }]}
      >
        {cd.seconds}
      </Text>
      <View style={[styles.track, { backgroundColor: rgba(tokens.ink, 0.1) }]}>
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
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  floating: {
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  secs: {
    fontSize: 13,
    fontWeight: '700',
    minWidth: 26,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  pausedText: { fontSize: 13 },
  track: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 999 },
});
