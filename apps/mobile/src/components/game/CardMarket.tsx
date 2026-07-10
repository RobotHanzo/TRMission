// The face-up market + draw deck (ports the web CardMarket 1:1, incl. the draw-pool gate and the
// no-loco-second-draw engine rule). Slots and the deck register themselves as flight targets
// (`market-slot-{i}` / `deck`) for the Task 10 card-flight animations.
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Layers } from 'lucide-react-native';
import { CardColor as PbCardColor, Phase, type GameSnapshot } from '@trm/proto';
import { tokenForPb } from '../../game/cards';
import { handFromCounts, handTotal } from '../../game/payments';
import { LIVERY_GRADIENT_COLORS } from '../../theme/colors';
import { useAnimationsStore } from '../../store/animations';
import { registerAnimTarget } from './animTargets';

interface Props {
  snapshot: GameSnapshot;
  canDraw: boolean;
  onDrawFaceUp(slot: number): void;
  onDrawBlind(): void;
}

export function CardMarket({ snapshot, canDraw, onDrawFaceUp, onDrawBlind }: Props) {
  const { t } = useTranslation();
  const coveredSlots = useAnimationsStore((s) => s.coveredMarketSlots);
  // A blind draw is legal while ANY card remains in the draw pool: an empty deck reshuffles the
  // discard back in. Gating on deckCount alone hard-locks a player late-game (deck spent, discard
  // full of claimed cards). The engine guarantees DRAWING_CARDS is never entered unless a second
  // draw is actually possible, so gating on drawPool alone is safe here too.
  const drawPool = snapshot.deckCount + handTotal(handFromCounts(snapshot.discard));
  const isSecondDraw = snapshot.phase === Phase.DRAWING_CARDS;

  return (
    <View style={styles.market}>
      <Pressable
        testID="market-deck"
        ref={(v) => registerAnimTarget('deck', v)}
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
          const disabled = !canDraw || empty || (isSecondDraw && isLoco);
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
              ref={(v) => registerAnimTarget(`market-slot-${slot}`, v)}
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
              {face}
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
