// The face-up market + draw deck (ports the web CardMarket 1:1, incl. the draw-pool gate and the
// no-loco-second-draw engine rule). Slots and the deck register themselves as flight targets
// (`market-slot-{i}` / `deck`) for the Task 10 card-flight animations.
import { useEffect, useRef, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Layers } from 'lucide-react-native';
import { CardColor as PbCardColor, Phase, type GameSnapshot } from '@trm/proto';
import { tokenForPb } from '../../game/cards';
import { handFromCounts, handTotal } from '../../game/payments';
import { LIVERY_GRADIENT_COLORS } from '../../theme/colors';
import { useAnimationsStore } from '../../store/animations';
import {
  TUTORIAL_ANCHORS,
  useTutorialAnchor,
  useTutorialTargets,
} from '../../features/tutorial/targets';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { registerAnimTarget } from './animTargets';

/** A refilled slot's face flips in (web `.market-slot.is-flipping`, 0.45s). */
function SlotFlip({
  flipping,
  reduced,
  children,
}: PropsWithChildren<{ flipping: boolean; reduced: boolean }>) {
  const progress = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!flipping || reduced) return;
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 450,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [flipping, reduced, progress]);
  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          { perspective: 600 },
          { rotateY: progress.interpolate({ inputRange: [0, 1], outputRange: ['80deg', '0deg'] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

interface Props {
  snapshot: GameSnapshot;
  canDraw: boolean;
  onDrawFaceUp(slot: number): void;
  onDrawBlind(): void;
  /** All Seats Reserved: face-up locomotives may not be taken at all while it's active. */
  blockFaceupLocomotives?: boolean;
}

export function CardMarket({
  snapshot,
  canDraw,
  onDrawFaceUp,
  onDrawBlind,
  blockFaceupLocomotives = false,
}: Props) {
  const { t } = useTranslation();
  const coveredSlots = useAnimationsStore((s) => s.coveredMarketSlots);
  const marketFlips = useAnimationsStore((s) => s.marketFlips);
  const reduced = useReducedMotion();
  // Tutorial spotlight anchors (no-ops outside the tutorial provider). The five slots share ONE
  // anchor id, so they register straight into the registry with per-slot cleanups — a single
  // useTutorialAnchor instance would unregister slot N when slot N+1's ref fires.
  const marketAnchor = useTutorialAnchor(TUTORIAL_ANCHORS.market);
  const deckAnchor = useTutorialAnchor(TUTORIAL_ANCHORS.deck);
  const targets = useTutorialTargets();
  const slotAnchorCleanups = useRef(new Map<number, () => void>()).current;
  // A blind draw is legal while ANY card remains in the draw pool: an empty deck reshuffles the
  // discard back in. Gating on deckCount alone hard-locks a player late-game (deck spent, discard
  // full of claimed cards). The engine guarantees DRAWING_CARDS is never entered unless a second
  // draw is actually possible, so gating on drawPool alone is safe here too.
  const drawPool = snapshot.deckCount + handTotal(handFromCounts(snapshot.discard));
  const isSecondDraw = snapshot.phase === Phase.DRAWING_CARDS;

  return (
    <View {...marketAnchor} style={styles.market}>
      <Pressable
        testID="market-deck"
        ref={(v) => {
          registerAnimTarget('deck', v);
          deckAnchor.ref(v);
        }}
        collapsable={false}
        style={({ pressed }) => [styles.deck, pressed && styles.pressed]}
        disabled={!canDraw || drawPool === 0}
        onPress={onDrawBlind}
        accessibilityRole="button"
        accessibilityLabel={t('drawBlind')}
        accessibilityState={{ disabled: !canDraw || drawPool === 0 }}
      >
        <Layers size={18} color="#fff" />
        <Text style={styles.deckCount}>{snapshot.deckCount}</Text>
      </Pressable>

      <View style={styles.slots}>
        {snapshot.market.map((card, slot) => {
          const tok = tokenForPb(card);
          const empty = card === PbCardColor.UNSPECIFIED || !tok;
          // The wild loco is "any colour" — paint it with the rainbow, not its flat grey hex.
          const isLoco = tok?.key === 'LOCOMOTIVE';
          // A covered slot has a real (refilled) card underneath but stays face-down until the
          // active draw resolves — still drawable, just not yet revealed.
          const covered = coveredSlots.has(slot);
          const disabled =
            !canDraw || empty || (isLoco && (isSecondDraw || blockFaceupLocomotives));
          const face = covered ? (
            <Layers size={16} color="#fff" />
          ) : (
            <Text style={[styles.slotGlyph, { color: tok?.ink ?? '#666' }]}>
              {tok ? tok.glyph : '·'}
            </Text>
          );
          return (
            <Pressable
              key={slot}
              testID={`market-slot-${slot}`}
              ref={(v) => {
                registerAnimTarget(`market-slot-${slot}`, v);
                slotAnchorCleanups.get(slot)?.();
                if (v)
                  slotAnchorCleanups.set(slot, targets.register(TUTORIAL_ANCHORS.marketSlot, v));
                else slotAnchorCleanups.delete(slot);
              }}
              collapsable={false}
              style={({ pressed }) => [
                styles.slot,
                covered && styles.slotCovered,
                empty && styles.slotEmpty,
                !covered && !empty && !isLoco && tok ? { backgroundColor: tok.hex } : null,
                pressed && !disabled && styles.pressed,
              ]}
              disabled={disabled}
              onPress={() => onDrawFaceUp(slot)}
              accessibilityRole="button"
              accessibilityLabel={covered ? t('drawBlind') : tok ? tok.nameZh : 'empty'}
              accessibilityState={{ disabled }}
            >
              {!covered && !empty && isLoco && (
                <LinearGradient
                  colors={LIVERY_GRADIENT_COLORS}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
              )}
              <SlotFlip flipping={marketFlips.has(slot)} reduced={reduced}>
                {face}
              </SlotFlip>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  market: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  deck: {
    minWidth: 48,
    height: 56,
    borderRadius: 8,
    backgroundColor: '#3a4149',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 6,
  },
  deckCount: { color: '#fff', fontSize: 12, fontWeight: '700' },
  slots: { flexDirection: 'row', gap: 6, flex: 1 },
  slot: {
    flex: 1,
    height: 56,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.22)',
    overflow: 'hidden',
    backgroundColor: '#d8d3c8',
  },
  slotCovered: { backgroundColor: '#3a4149' },
  slotEmpty: { opacity: 0.4 },
  slotGlyph: { fontSize: 18, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
