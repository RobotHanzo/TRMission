// The tunnel reveal + surcharge modal (ports the web TunnelModal). The reveal is public, so
// everyone watches the drawn cards; only the claimant gets interactive payment options (their
// hand stays secret) — spectators see a read-only colour-only surcharge combination. The result
// is held back for the reveal duration so the outcome isn't spoiled (flip animation lands in
// Task 10; the tunnelDraw/success sound cues land in Task 11).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { CardColor as PbCardColor } from '@trm/proto';
import { CARD_COLOR_TOKENS } from '../../theme/colors';
import { pbToCard } from '../../game/cards';
import type { Payment } from '../../game/payments';
import { tunnelRevealMs } from '../../game/tunnel';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { TrainCarCard } from './TrainCarCard';

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

  useEffect(() => {
    if (reduced) {
      setShowResult(true);
      return;
    }
    setShowResult(false);
    const timer = setTimeout(() => setShowResult(true), tunnelRevealMs(revealed.length, reduced));
    return () => clearTimeout(timer);
  }, [revealed, reduced]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onAbort}>
      <View style={styles.backdrop}>
        <View style={styles.modal}>
          <Text style={styles.title}>{t('tunnel')}</Text>
          <View style={styles.reveal}>
            {revealed.map((c, i) => {
              const color = pbToCard(c);
              if (!color) return null;
              return <TrainCarCard key={i} color={color} size={CARD_SIZE} />;
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
