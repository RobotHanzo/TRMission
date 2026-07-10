// A single train-card chip (ports the web CardSwatch): a colour square carrying its glyph for
// colour-blind readability, with an optional ×N count.
import { StyleSheet, Text, View } from 'react-native';
import type { CardColor } from '@trm/shared';
import { CARD_COLOR_TOKENS } from '../../theme/colors';

interface Props {
  color: CardColor;
  count?: number | undefined;
  showGlyph?: boolean | undefined;
  size?: number | undefined;
}

export function CardSwatch({ color, count, showGlyph = true, size = 30 }: Props) {
  const tok = CARD_COLOR_TOKENS[color];
  return (
    <View
      style={[styles.swatch, { backgroundColor: tok.hex, width: size, height: size }]}
      accessibilityLabel={`${tok.nameZh}${count !== undefined ? ` ×${count}` : ''}`}
    >
      <Text style={[styles.glyph, { color: tok.ink, fontSize: size * 0.42 }]}>
        {showGlyph ? tok.glyph : ''}
      </Text>
      {count !== undefined && (
        <View style={styles.countChip}>
          <Text style={styles.countText}>{count}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  swatch: {
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.25)',
  },
  glyph: { fontWeight: '700' },
  countChip: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: '#1f2328',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { color: '#fff', fontSize: 10, fontWeight: '700' },
});
