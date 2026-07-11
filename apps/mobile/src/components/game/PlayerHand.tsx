// The player's hand as a row of big train-car cards, one per colour held (ports the web
// PlayerHand). Colour-blind glyph chips follow the ui setting — on a phone the glyphs are
// clutter unless they're needed.
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { CARD_COLORS } from '@trm/shared';
import type { CardCounts } from '@trm/proto';
import { handFromCounts } from '../../game/payments';
import { useUi } from '../../store/ui';
import { registerAnimTarget } from './animTargets';
import { TrainCarCard } from './TrainCarCard';

export function PlayerHand({ hand }: { hand: CardCounts | undefined }) {
  const { t } = useTranslation();
  const colorBlind = useUi((s) => s.colorBlind);
  const h = handFromCounts(hand);
  const present = CARD_COLORS.filter((c) => h[c] > 0);
  return (
    // The wrapper (registered even while empty) is the card-flight destination for your own draws.
    <View ref={(v) => registerAnimTarget('hand', v)} collapsable={false}>
      {present.length === 0 ? (
        <Text style={styles.muted}>{t('noCards')}</Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        >
          {present.map((c) => (
            <TrainCarCard key={c} color={c} count={h[c]} showGlyph={colorBlind} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, paddingHorizontal: 4, alignItems: 'center' },
  muted: { opacity: 0.55, fontSize: 13, padding: 8 },
});
