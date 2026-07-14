// Five-star picker (ports the web StarRating). `value` is 0-5 (0 = none selected yet).
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Star } from 'lucide-react-native';

const STAR_COLOR = '#e8a33d';

interface Props {
  value: number;
  onChange(stars: number): void;
  size?: number;
  disabled?: boolean;
}

export function StarRating({ value, onChange, size = 32, disabled = false }: Props) {
  const { t } = useTranslation();
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={t('rateAppPrompt')}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          testID={`star-${n}`}
          style={styles.star}
          accessibilityRole="radio"
          accessibilityLabel={t('starRatingValue', { n })}
          accessibilityState={{ checked: value === n, disabled }}
          disabled={disabled}
          onPress={() => onChange(n)}
        >
          <Star size={size} color={STAR_COLOR} fill={n <= value ? STAR_COLOR : 'none'} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 2, alignItems: 'center' },
  star: { padding: 4, minWidth: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
});
