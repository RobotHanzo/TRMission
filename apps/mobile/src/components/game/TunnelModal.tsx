// The tunnel reveal + surcharge modal (ports the web TunnelModal). The reveal is public, so
// everyone watches the drawn cards; only the claimant gets interactive payment options (their
// hand stays secret) — spectators see a read-only colour-only surcharge combination. The result
// is held back for the reveal duration so the outcome isn't spoiled; each card flips in on the
// shared stagger with a tunnelDraw tick, then tunnelSuccess/tunnelPayment lands with the result.
import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { CardColor as PbCardColor } from '@trm/proto';
import { REVEAL_FLIP_MS, REVEAL_STAGGER_MS } from '@trm/client-core/game/tunnel';
import { CARD_COLOR_TOKENS } from '../../theme/colors';
import { pbToCard } from '../../game/cards';
import type { Payment } from '../../game/payments';
import { tunnelRevealMs } from '../../game/tunnel';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { soundPlayer } from '../../sound/player';
import { TrainCarCard } from './TrainCarCard';

/** One revealed card flipping in on the shared stagger (web `.tunnel-reveal-card`): a rotateY
 *  swing from face-down with a fade, slow for suspense. Plain RN Animated — low-frequency UI. */
function FlipInCard({
  index,
  reduced,
  children,
}: PropsWithChildren<{ index: number; reduced: boolean }>) {
  const progress = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) return;
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: REVEAL_FLIP_MS,
      delay: index * REVEAL_STAGGER_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [progress, index, reduced]);
  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          { perspective: 800 },
          {
            rotateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: ['80deg', '0deg'],
            }),
          },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

interface Props {
  revealed: PbCardColor[];
  extraRequired: number;
  options: Payment[];
  /** The colour the surcharge must be matched in (UNSPECIFIED for an all-locomotive claim). */
  playedColor?: PbCardColor | undefined;
  /** A non-claimant viewer: watches the reveal, but sees only a read-only surcharge combination. */
  spectator?: boolean | undefined;
  onCommit(p: Payment): void;
  onAbort(): void;
}

const CARD_SIZE = 84;

/** Describes a spend option for assistive tech, e.g. "藍 ×2 + 彩虹車頭 ×1". */
const describe = (p: Payment): string => {
  const parts: string[] = [];
  if (p.color && p.colorCount > 0)
    parts.push(`${CARD_COLOR_TOKENS[p.color].nameZh} ×${p.colorCount}`);
  if (p.locomotives > 0) parts.push(`${CARD_COLOR_TOKENS.LOCOMOTIVE.nameZh} ×${p.locomotives}`);
  return parts.join(' + ');
};

export function TunnelModal({
  revealed,
  extraRequired,
  options,
  playedColor,
  spectator = false,
  onCommit,
  onAbort,
}: Props) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  // Hold the surcharge result + payment choices back until the reveal window has passed, so the
  // outcome isn't spoiled before the cards have (visually) arrived.
  const [showResult, setShowResult] = useState(reduced);

  const resultCuePlayed = useRef(false);

  useEffect(() => {
    if (reduced) {
      setShowResult(true);
      return;
    }
    setShowResult(false);
    const timer = setTimeout(() => setShowResult(true), tunnelRevealMs(revealed.length, reduced));
    return () => clearTimeout(timer);
  }, [revealed, reduced]);

  // Card-placement tick per revealed tunnel card, synced to the flip stagger.
  useEffect(() => {
    if (reduced) {
      soundPlayer.play('tunnelDraw');
      return;
    }
    const timers = revealed.map((_, i) =>
      setTimeout(() => soundPlayer.play('tunnelDraw'), i * REVEAL_STAGGER_MS),
    );
    return () => timers.forEach((id) => clearTimeout(id));
  }, [revealed, reduced]);

  // Result cue once the surcharge outcome is shown.
  useEffect(() => {
    if (showResult && !resultCuePlayed.current) {
      resultCuePlayed.current = true;
      soundPlayer.play(extraRequired === 0 ? 'tunnelSuccess' : 'tunnelPayment');
    }
  }, [showResult, extraRequired]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onAbort}>
      <View style={styles.backdrop}>
        <View style={styles.modal}>
          <Text style={styles.title}>{t('tunnel')}</Text>
          {/* The drawn cards flip in one at a time (slow, for suspense). */}
          <View style={styles.reveal}>
            {revealed.map((c, i) => {
              const color = pbToCard(c);
              if (!color) return null;
              return (
                <FlipInCard key={i} index={i} reduced={reduced}>
                  <TrainCarCard color={color} size={CARD_SIZE} />
                </FlipInCard>
              );
            })}
          </View>

          {showResult && spectator && (
            <View style={styles.result}>
              <Text style={styles.surcharge}>
                {extraRequired === 0 ? t('tunnelNoExtra') : t('payExtra', { n: extraRequired })}
              </Text>
              {extraRequired > 0 &&
                (() => {
                  // The surcharge as a single colour-only combination: N cards of the played
                  // colour (locomotives if the base claim played no colour). Read-only — it
                  // leaks nothing about the claimant's hand.
                  const surchargeColor = pbToCard(playedColor ?? 0) ?? 'LOCOMOTIVE';
                  return (
                    <View
                      style={styles.readonlyOption}
                      accessibilityLabel={`${CARD_COLOR_TOKENS[surchargeColor].nameZh} ×${extraRequired}`}
                    >
                      <TrainCarCard color={surchargeColor} count={extraRequired} size={CARD_SIZE} />
                    </View>
                  );
                })()}
            </View>
          )}

          {showResult && !spectator && (
            <View style={styles.result}>
              {options.length === 0 ? (
                // Can't afford the surcharge — nothing to pay; abort is the only way on.
                <Text style={styles.cannot}>{t('cannotAfford')}</Text>
              ) : (
                <>
                  <Text style={styles.surcharge}>
                    {extraRequired === 0 ? t('tunnelNoExtra') : t('payExtra', { n: extraRequired })}
                  </Text>
                  <ScrollView style={styles.optionsScroll} contentContainerStyle={styles.options}>
                    {options.map((p, i) => {
                      const hasCards = (p.color && p.colorCount > 0) || p.locomotives > 0;
                      return (
                        <Pressable
                          key={i}
                          style={({ pressed }) => [styles.option, pressed && styles.pressed]}
                          accessibilityRole="button"
                          accessibilityLabel={hasCards ? describe(p) : t('confirm')}
                          onPress={() => onCommit(p)}
                        >
                          {p.color && p.colorCount > 0 && (
                            <TrainCarCard color={p.color} count={p.colorCount} size={CARD_SIZE} />
                          )}
                          {p.locomotives > 0 && (
                            <TrainCarCard
                              color="LOCOMOTIVE"
                              count={p.locomotives}
                              size={CARD_SIZE}
                            />
                          )}
                          {!hasCards && <Text style={styles.confirmText}>{t('confirm')}</Text>}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </>
              )}
              <View style={styles.row}>
                <Pressable style={styles.abortBtn} accessibilityRole="button" onPress={onAbort}>
                  <Text style={styles.abortText}>{t('abort')}</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modal: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    borderRadius: 12,
    backgroundColor: '#fffdf8',
    padding: 16,
    gap: 10,
  },
  title: { fontSize: 16, fontWeight: '700' },
  reveal: { flexDirection: 'row', gap: 8, justifyContent: 'center', flexWrap: 'wrap' },
  result: { gap: 8 },
  surcharge: { fontSize: 14, fontWeight: '600' },
  cannot: { fontSize: 14, fontWeight: '600', textAlign: 'center', opacity: 0.7 },
  readonlyOption: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.16)',
    backgroundColor: 'rgba(0,0,0,0.03)',
    padding: 10,
    alignSelf: 'flex-start',
  },
  optionsScroll: { flexGrow: 0 },
  options: { gap: 8 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.16)',
    backgroundColor: 'rgba(0,0,0,0.03)',
    padding: 10,
    minHeight: 44,
  },
  confirmText: { fontSize: 14, fontWeight: '700', color: '#1d4ed8' },
  pressed: { opacity: 0.75 },
  row: { flexDirection: 'row', justifyContent: 'flex-end' },
  abortBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  abortText: { fontSize: 14, fontWeight: '600', color: '#b3261e' },
});
