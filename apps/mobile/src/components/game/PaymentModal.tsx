// Lets the player choose which combination of cards to spend (ports the web PaymentModal).
// Spend options render as the same rolling-stock cards as the hand, scaled down so a couple of
// options stack neatly.
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CARD_COLOR_TOKENS } from '../../theme/colors';
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

/** A fully-empty payment is the gala zero-cost station (offered only while its window is up). */
const isFree = (p: Payment): boolean => p.colorCount === 0 && p.locomotives === 0;

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
  const anchor = useTutorialAnchor(TUTORIAL_ANCHORS.paymentOptions);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.modal} onPress={() => undefined}>
          <Text style={styles.title}>{title}</Text>
          {options.length === 0 ? (
            <Text style={styles.muted}>{t('cannotAfford')}</Text>
          ) : (
            <View {...anchor} style={styles.optionsScroll}>
              <ScrollView contentContainerStyle={styles.options}>
                {options.map((p, i) => (
                  <Pressable
                    key={i}
                    style={({ pressed }) => [
                      styles.option,
                      isFree(p) && styles.optionFree,
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={isFree(p) ? t('events.freeStation') : describe(p)}
                    onPress={() => onPick(p)}
                  >
                    {isFree(p) && <Text style={styles.freeLabel}>{t('events.freeStation')}</Text>}
                    {p.color && p.colorCount > 0 && (
                      <TrainCarCard color={p.color} count={p.colorCount} size={CARD_SIZE} />
                    )}
                    {p.locomotives > 0 && (
                      <TrainCarCard color="LOCOMOTIVE" count={p.locomotives} size={CARD_SIZE} />
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
          <View style={styles.row}>
            <Pressable style={styles.cancelBtn} accessibilityRole="button" onPress={onCancel}>
              <Text style={styles.cancelText}>{t('game.back')}</Text>
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
    backgroundColor: '#fffdf8',
    padding: 16,
    gap: 10,
  },
  title: { fontSize: 16, fontWeight: '700' },
  muted: { opacity: 0.6, fontSize: 13 },
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
  optionFree: { borderColor: '#2e7d32', backgroundColor: 'rgba(46,125,50,0.08)' },
  freeLabel: { color: '#2e7d32', fontWeight: '700', fontSize: 13 },
  pressed: { opacity: 0.75 },
  row: { flexDirection: 'row', justifyContent: 'flex-end' },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  cancelText: { fontSize: 14, fontWeight: '600', color: '#1d4ed8' },
});
