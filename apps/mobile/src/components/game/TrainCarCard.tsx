// A board-game-sized train-car card (ports the web TrainCarCard): the original rolling-stock
// artwork on a livery-tinted face with a colour edge band. A ×N count chip and a stacked-deck
// shadow communicate how many of the colour you hold; the glyph chip keeps it readable in
// colour-blind mode. The wild loco wears the rainbow edge via expo-linear-gradient.
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { CardColor } from '@trm/shared';
import { CARD_COLOR_TOKENS, LIVERY_GRADIENT_COLORS } from '../../theme/colors';
import { rgba } from '../../theme/shade';
import { TrainCarArt } from './TrainCarArt';

interface Props {
  color: CardColor;
  count?: number | undefined;
  /** Show the colour-blind glyph chip. */
  showGlyph?: boolean | undefined;
  /** Show the "×N" count chip. */
  showCount?: boolean | undefined;
  /** Override the card width (dp); height follows the fixed 132×72-art aspect. */
  size?: number | undefined;
}

const CARD_W = 92;
const ASPECT = 92 / 64; // card width : height (art + padding), matching the web proportions

export function TrainCarCard({ color, count, showGlyph = true, showCount = true, size }: Props) {
  const tok = CARD_COLOR_TOKENS[color];
  const isLoco = color === 'LOCOMOTIVE';
  const n = count ?? 0;
  const stacked = n > 1;
  const deep = n > 2;
  const w = size ?? CARD_W;
  const h = w / ASPECT;

  return (
    <View
      style={{ width: w, height: h }}
      accessibilityRole="image"
      accessibilityLabel={`${tok.nameZh}${count !== undefined ? ` ×${count}` : ''}`}
    >
      {/* stacked-deck shadow: 2 → one card behind, 3+ → two (visually capped at 3-deep) */}
      {deep && <View style={[styles.stackCard, { width: w, height: h, top: 5, left: 5 }]} />}
      {stacked && <View style={[styles.stackCard, { width: w, height: h, top: 2.5, left: 2.5 }]} />}

      <View style={[styles.card, { width: w, height: h, backgroundColor: rgba(tok.hex, 0.14) }]}>
        {isLoco ? (
          <LinearGradient
            colors={LIVERY_GRADIENT_COLORS}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.edge}
          />
        ) : (
          <View style={[styles.edge, { backgroundColor: tok.hex }]} />
        )}
        <View style={styles.art}>
          <TrainCarArt color={color} />
        </View>
        {showGlyph && (
          <View style={[styles.glyphChip, { backgroundColor: tok.hex }]}>
            <Text style={[styles.glyphText, { color: tok.ink }]}>{tok.glyph}</Text>
          </View>
        )}
        {count !== undefined && showCount && (
          <View style={styles.countChip}>
            <Text style={styles.countText}>×{count}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.22)',
    overflow: 'hidden',
  },
  stackCard: {
    position: 'absolute',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.18)',
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  edge: { position: 'absolute', top: 0, left: 0, right: 0, height: 5 },
  art: { flex: 1, marginTop: 5, paddingHorizontal: 2 },
  glyphChip: {
    position: 'absolute',
    top: 7,
    left: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.25)',
  },
  glyphText: { fontSize: 9, fontWeight: '700' },
  countChip: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    backgroundColor: 'rgba(31,35,40,0.85)',
  },
  countText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
