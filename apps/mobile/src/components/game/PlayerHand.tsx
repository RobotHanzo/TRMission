// The player's hand as a row of big train-car cards, one per colour held (ports the web
// PlayerHand). Colour-blind glyph chips follow the ui setting — on a phone the glyphs are
// clutter unless they're needed.
//
// `brief` is the collapsed reading (issue #79): the same cards at the tutorial glossary's small
// size, WRAPPED instead of scrolled, so the whole hand is legible at a glance in the height a
// couple of rows costs — the phone dock's Cards tab now carries the draw market above it and
// can't spare the full-size row all the time.
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { CardRowScroll } from './CardRowScroll';
import { CARD_COLORS } from '@trm/shared';
import type { CardCounts } from '@trm/proto';
import { handFromCounts } from '../../game/payments';
import { useTheme } from '../../theme/useTheme';
import { useUi } from '../../store/ui';
import { registerAnimTarget } from './animTargets';
import { TUTORIAL_ANCHORS, useTutorialAnchor } from '../../features/tutorial/targets';
import { TrainCarCard } from './TrainCarCard';

/** The collapsed card width — the tutorial glossary's specimen size (Specimens.tsx CARD_W). */
const BRIEF_CARD_W = 56;

export function PlayerHand({
  hand,
  brief,
}: {
  hand: CardCounts | undefined;
  brief?: boolean | undefined;
}) {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const colorBlind = useUi((s) => s.colorBlind);
  const anchor = useTutorialAnchor(TUTORIAL_ANCHORS.hand);
  const h = handFromCounts(hand);
  const present = CARD_COLORS.filter((c) => h[c] > 0);
  const cards = present.map((c) => (
    <TrainCarCard
      key={c}
      color={c}
      count={h[c]}
      showGlyph={colorBlind}
      {...(brief ? { size: BRIEF_CARD_W } : {})}
    />
  ));
  return (
    // The wrapper (registered even while empty) is the card-flight destination for your own draws
    // and the tutorial's hand spotlight anchor — in both readings, so a collapsed hand still
    // catches its own draws.
    <View
      ref={(v) => {
        registerAnimTarget('hand', v);
        anchor.ref(v);
      }}
      collapsable={false}
    >
      {present.length === 0 ? (
        <Text style={[styles.muted, { color: tokens.inkSoft }]}>{t('noCards')}</Text>
      ) : brief ? (
        <View style={styles.briefRow}>{cards}</View>
      ) : (
        <CardRowScroll contentContainerStyle={styles.row}>{cards}</CardRowScroll>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, paddingHorizontal: 4, alignItems: 'center' },
  briefRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 4 },
  muted: { fontSize: 13, padding: 8 },
});
