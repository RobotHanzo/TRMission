// Lets the player choose which combination of cards to spend (ports the web PaymentModal).
// Spend options render as the same rolling-stock cards as the hand, scaled down so a couple of
// options stack neatly.
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CARD_COLOR_TOKENS } from '../../theme/colors';
import { useTheme } from '../../theme/useTheme';
import { rgba } from '../../theme/shade';
import type { Payment } from '../../game/payments';
import { TUTORIAL_ANCHORS, useTutorialAnchor } from '../../features/tutorial/targets';
import { TrainCarCard } from './TrainCarCard';

interface Props {
  title: string;
  options: Payment[];
  onPick(p: Payment): void;
  onCancel(): void;
}

const CARD_SIZE = 96;

/** A truly empty, unmodified payment is the gala zero-cost station. A token-only Bento WILD or
 *  empty repair-permit payment must never be mislabeled as a free station. */
const isFree = (p: Payment): boolean =>
  p.colorCount === 0 &&
  p.locomotives === 0 &&
  !p.bentoSpend &&
  !p.useClaimDiscount &&
  !p.repairPermit;

/** Describes a spend option for assistive tech, e.g. "藍 ×2 + 彩虹車頭 ×1". */
const describe = (p: Payment): string => {
  const parts: string[] = [];
  if (p.color && p.colorCount > 0)
    parts.push(`${CARD_COLOR_TOKENS[p.color].nameZh} ×${p.colorCount}`);
  if (p.locomotives > 0) parts.push(`${CARD_COLOR_TOKENS.LOCOMOTIVE.nameZh} ×${p.locomotives}`);
  return parts.join(' + ');
};

export function PaymentModal({ title, options, onPick, onCancel }: Props) {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const anchor = useTutorialAnchor(TUTORIAL_ANCHORS.paymentOptions);
  // Event-resource labels riding on a payment option (Bento token, claim discount, +2 bonus, …).
  const modifierLabels = (p: Payment): string[] => [
    ...(p.bentoSpend === 'WILD' ? [t('events.bentoWild')] : []),
    ...(p.bentoSpend === 'POINTS' ? [t('events.bentoPoints')] : []),
    ...(p.useClaimDiscount ? [t('events.perkClaimDiscount')] : []),
    ...(p.allSeatsBonus ? [t('events.allSeatsBonus')] : []),
    ...(p.repairPermit ? [t('events.repairWithPermit')] : []),
  ];
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable testID="payment-backdrop" style={styles.backdrop} onPress={onCancel}>
        <Pressable
          style={[styles.modal, { backgroundColor: tokens.surface }]}
          onPress={() => undefined}
        >
          <Text style={[styles.title, { color: tokens.ink }]}>{title}</Text>
          {options.length === 0 ? (
            <Text style={[styles.muted, { color: tokens.inkSoft }]}>{t('cannotAfford')}</Text>
          ) : (
            <View {...anchor} style={styles.optionsScroll}>
              <ScrollView contentContainerStyle={styles.options}>
                {options.map((p, i) => {
                  const modifiers = modifierLabels(p);
                  const aria = [describe(p), ...modifiers].filter(Boolean).join(' · ');
                  return (
                    <Pressable
                      key={i}
                      style={({ pressed }) => [
                        styles.option,
                        { borderColor: tokens.line, backgroundColor: rgba(tokens.ink, 0.03) },
                        isFree(p) && {
                          borderColor: tokens.ok,
                          backgroundColor: rgba(tokens.ok, 0.08),
                        },
                        pressed && styles.pressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={isFree(p) ? t('events.freeStation') : aria}
                      onPress={() => onPick(p)}
                    >
                      {isFree(p) && (
                        <Text style={[styles.freeLabel, { color: tokens.ok }]}>
                          {t('events.freeStation')}
                        </Text>
                      )}
                      {modifiers.length > 0 && (
                        <View style={styles.modifiers}>
                          {modifiers.map((label) => (
                            <Text key={label} style={styles.modifier}>
                              {label}
                            </Text>
                          ))}
                        </View>
                      )}
                      {p.color && p.colorCount > 0 && (
                        <TrainCarCard color={p.color} count={p.colorCount} size={CARD_SIZE} />
                      )}
                      {p.locomotives > 0 && (
                        <TrainCarCard color="LOCOMOTIVE" count={p.locomotives} size={CARD_SIZE} />
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}
          <View style={styles.row}>
            <Pressable style={styles.cancelBtn} accessibilityRole="button" onPress={onCancel}>
              <Text style={[styles.cancelText, { color: tokens.blue }]}>{t('game.back')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
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
    maxHeight: '80%',
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  title: { fontSize: 16, fontWeight: '700' },
  muted: { fontSize: 13 },
  optionsScroll: { flexGrow: 0 },
  options: { gap: 8 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    minHeight: 44,
  },
  freeLabel: { fontWeight: '700', fontSize: 13 },
  modifiers: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, maxWidth: 120 },
  modifier: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7c2d12',
    backgroundColor: 'rgba(238,107,31,0.14)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  pressed: { opacity: 0.75 },
  row: { flexDirection: 'row', justifyContent: 'flex-end' },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  cancelText: { fontSize: 14, fontWeight: '600' },
});
