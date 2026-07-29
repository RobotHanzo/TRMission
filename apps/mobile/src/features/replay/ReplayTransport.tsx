// The replay transport — the RN port of apps/web's route strip (see that file and
// features/replay/CLAUDE.md there for the design; the two must stay recognisably the same
// instrument). A finished game is a line already travelled, so the scrubber is drawn as one:
// sections one per turn, as long as that turn ran and in the acting seat's livery, thickening on
// the turns that put track on the board; stations and tunnels sit on the line as marks; the
// section under the playhead goes to full saturation and everything past it is washed back.
//
// Touch differences from web: there is no range input to lay over the strip, so the strip itself
// is the seek target (tap anywhere on it) and every control meets the 44dp tap minimum.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { ChevronFirst, ChevronLast, Pause, Play, StepBack, StepForward } from 'lucide-react-native';
import type { Action } from '@trm/engine';
import { buildReplayTimeline, turnAtStep, turnBoundaries } from '@trm/client-core/replay/timeline';
import { REPLAY_SPEEDS, type ReplayControls } from '@trm/client-core/replay/useReplayPlayer';
import type { ReplayPlayerMeta } from '../../net/rest';
import { seatColor } from '../../theme/colors';
import { rgba } from '../../theme/shade';
import { useTheme } from '../../theme/useTheme';
import { DashedLeader } from '../../theme/gameChrome';

const STRIP_H = 34;
const LINE_THIN = 5;
const LINE_TRACK = 13;
const MARK = 10;

export function ReplayTransport({
  actions,
  players,
  player,
  playerName,
}: {
  actions: readonly Action[];
  players: readonly ReplayPlayerMeta[];
  player: ReplayControls;
  /** Seat → label, resolved by the screen (roster names, bot labels, "you"). */
  playerName(turn: { id: string; seat: number }): string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const [stripWidth, setStripWidth] = useState(0);

  const seats = useMemo(() => new Map(players.map((p) => [p.userId, p.seat])), [players]);
  const timeline = useMemo(() => buildReplayTimeline(actions, seats), [actions, seats]);
  const boundaries = useMemo(() => turnBoundaries(timeline), [timeline]);

  // An empty log still renders a (degenerate) strip rather than a hole in the layout.
  const span = timeline.total || 1;
  const pct = (step: number): `${number}%` => `${(step / span) * 100}%`;

  const current = turnAtStep(timeline, player.step);
  const prevTurnStep = boundaries.filter((b) => b < player.step).pop();
  const nextTurnStep = boundaries.find((b) => b > player.step);

  const nowLabel = !current
    ? t('history.beforeStart')
    : current.setup
      ? t('history.openingDraft')
      : t('history.turnOf', {
          n: current.index,
          name: playerName({ id: current.player, seat: current.seat }),
        });

  return (
    <View style={[styles.bar, { backgroundColor: tokens.surface, borderTopColor: tokens.line }]}>
      <View style={styles.head}>
        <View
          style={[
            styles.nowBar,
            { backgroundColor: current && !current.setup ? seatColor(current.seat) : tokens.line },
          ]}
        />
        <Text style={[styles.nowLabel, { color: tokens.ink }]} numberOfLines={1}>
          {nowLabel}
        </Text>
        <DashedLeader color={tokens.line} />
        <View
          style={[styles.speed, { backgroundColor: tokens.surface2 }]}
          accessibilityRole="radiogroup"
          accessibilityLabel={t('history.speed')}
        >
          {REPLAY_SPEEDS.map((rate) => {
            const on = player.speed === rate;
            return (
              <Pressable
                key={rate}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={t('history.speedTimes', { n: rate })}
                onPress={() => player.setSpeed(rate)}
                style={[styles.speedBtn, on && { backgroundColor: tokens.surface }]}
              >
                <Text
                  style={[
                    styles.speedText,
                    { color: on ? tokens.ink : tokens.inkSoft },
                    on && styles.speedTextOn,
                  ]}
                >
                  ×{rate}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel={t('history.step', { n: player.step, total: player.total })}
        accessibilityValue={{ min: 0, max: player.total, now: player.step }}
        style={styles.strip}
        onLayout={(e: LayoutChangeEvent) => setStripWidth(e.nativeEvent.layout.width)}
        onPress={(e) => {
          if (stripWidth <= 0 || player.total === 0) return;
          const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / stripWidth));
          player.seek(Math.round(ratio * player.total));
        }}
      >
        {/* The rail, showing through the gaps between turns and past the last one. */}
        <View style={[styles.rail, { backgroundColor: tokens.line }]} />
        <View style={styles.turns}>
          {timeline.turns.map((turn) => (
            <View
              key={turn.from}
              style={[
                styles.turn,
                {
                  flexGrow: turn.to - turn.from,
                  height: turn.track > 0 ? LINE_TRACK : LINE_THIN,
                  borderRadius: turn.track > 0 ? 2 : 1,
                  // The opening draft is nobody's turn, so it takes no livery. Web hatches it;
                  // RN has no repeating gradient, and flat line-colour says the same thing.
                  backgroundColor: turn.setup
                    ? tokens.line
                    : turn === current
                      ? seatColor(turn.seat)
                      : rgba(seatColor(turn.seat), 0.62),
                },
              ]}
            />
          ))}
        </View>
        {/* A mark is a glyph inside a surface-coloured halo — drawn as a real wrapper View rather
            than a shadow, because RN shadows are a soft glow on iOS and nothing at all on Android
            without elevation, and this ring has to be crisp to read over a saturated section. */}
        {timeline.moments.map((moment) => (
          <View
            key={moment.step}
            style={[styles.halo, { left: pct(moment.step), backgroundColor: tokens.surface }]}
          >
            <View
              style={
                moment.kind === 'station'
                  ? [styles.mark, { borderRadius: 2, backgroundColor: seatColor(moment.seat) }]
                  : [
                      styles.mark,
                      {
                        borderRadius: MARK / 2,
                        backgroundColor: tokens.surface,
                        borderWidth: 2.5,
                        borderColor: seatColor(moment.seat),
                      },
                    ]
              }
            />
          </View>
        ))}
        <View
          style={[
            styles.ahead,
            { left: pct(player.step), backgroundColor: rgba(tokens.surface, 0.62) },
          ]}
        />
        <View style={[styles.head3, { left: pct(player.step), backgroundColor: tokens.ember }]} />
      </Pressable>

      <View style={styles.foot}>
        <TransportButton
          label={t('history.prevTurn')}
          disabled={prevTurnStep === undefined}
          onPress={() => player.seek(prevTurnStep ?? 0)}
        >
          <ChevronFirst size={18} color={tokens.ink} />
        </TransportButton>
        <TransportButton
          label={t('tutorial.prevStep')}
          disabled={player.step <= 0}
          onPress={player.prev}
        >
          <StepBack size={18} color={tokens.ink} />
        </TransportButton>
        <TransportButton
          label={player.playing ? t('tutorial.pause') : t('tutorial.play')}
          disabled={player.atEnd}
          onPress={player.playing ? player.pause : player.play}
          testID="replay-playpause"
          style={[styles.play, { backgroundColor: tokens.surface2, borderColor: tokens.line }]}
        >
          {player.playing ? (
            <Pause size={19} color={tokens.ink} />
          ) : (
            <Play size={19} color={tokens.ink} />
          )}
        </TransportButton>
        <TransportButton
          label={t('tutorial.nextStep')}
          disabled={player.atEnd}
          onPress={player.next}
          testID="replay-next"
        >
          <StepForward size={18} color={tokens.ink} />
        </TransportButton>
        <TransportButton
          label={t('history.nextTurn')}
          disabled={nextTurnStep === undefined}
          onPress={() => player.seek(nextTurnStep ?? player.total)}
        >
          <ChevronLast size={18} color={tokens.ink} />
        </TransportButton>
        <Text style={[styles.stepText, { color: tokens.inkSoft }]}>
          {t('history.step', { n: player.step, total: player.total })}
        </Text>
      </View>
    </View>
  );
}

function TransportButton({
  label,
  disabled,
  onPress,
  testID,
  style,
  children,
}: {
  label: string;
  disabled: boolean;
  onPress(): void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      {...(testID ? { testID } : {})}
      style={[styles.ctlBtn, disabled && styles.disabled, style]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { borderTopWidth: 1, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4, gap: 4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nowBar: { width: 4, height: 15, borderRadius: 1 },
  nowLabel: { flexShrink: 1, fontSize: 13, fontWeight: '600' },
  speed: { flexDirection: 'row', gap: 2, padding: 2, borderRadius: 999 },
  speedBtn: {
    minWidth: 34,
    minHeight: 26,
    paddingHorizontal: 8,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedText: { fontSize: 11, fontVariant: ['tabular-nums'] },
  speedTextOn: { fontWeight: '700' },

  strip: { height: STRIP_H, justifyContent: 'center' },
  // Absolute children need an explicit `top` here: without one, yoga falls back to the static
  // position, which inside a centring container is not the middle of the strip.
  rail: { position: 'absolute', left: 0, right: 0, top: (STRIP_H - 1) / 2, height: 1 },
  turns: { flexDirection: 'row', alignItems: 'center', gap: 1, height: STRIP_H },
  turn: { flexBasis: 0, minWidth: 1 },
  halo: {
    position: 'absolute',
    width: MARK + 3,
    height: MARK + 3,
    marginLeft: -(MARK + 3) / 2,
    top: (STRIP_H - MARK - 3) / 2,
    borderRadius: (MARK + 3) / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: { width: MARK, height: MARK },
  ahead: { position: 'absolute', top: 0, bottom: 0, right: 0 },
  head3: { position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1 },

  foot: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ctlBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  play: { borderWidth: 1, marginHorizontal: 2 },
  disabled: { opacity: 0.35 },
  stepText: { marginLeft: 'auto', fontSize: 11, fontVariant: ['tabular-nums'] },
});
