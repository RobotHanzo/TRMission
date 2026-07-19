// A mission (destination ticket) card (ports the web TicketCard): a mini-map preview of the two
// endpoint cities over the Taiwan board, a ticket stub with the city pair, and the point value.
// Long routes wear an EMU-blue livery, short routes a warm ember one. With `onToggle` the card
// becomes a pressable toggle (used while choosing tickets). Theme-aware like the web's
// var(--tr-*)-driven .ticket-card: the card chrome and the mini-map both follow light/dark.
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { MAP_PALETTE_DARK, MAP_PALETTE_LIGHT } from '@trm/map-data';
import { ticketById, ticketLabel } from '../../game/content';
import { useUi } from '../../store/ui';
import { useTheme } from '../../theme/useTheme';
import { mix } from '../../theme/shade';
import { RoutePreview } from './RoutePreview';

interface Props {
  ticketId: string;
  /** When provided the card becomes a toggle (used while choosing tickets). */
  selected?: boolean | undefined;
  onToggle?: ((id: string) => void) | undefined;
  /** Prevents toggling (for mandatory long tickets during initial selection). */
  disabled?: boolean | undefined;
  /** Greys the card out and stamps a completion checkmark (finished mission). */
  completed?: boolean | undefined;
}

export function TicketCard({ ticketId, selected, onToggle, disabled, completed }: Props) {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const { tokens, dark } = useTheme();
  const def = ticketById.get(ticketId);
  const label = ticketLabel(ticketId, locale);
  if (!def || !label) return null;

  const palette = dark ? MAP_PALETTE_DARK : MAP_PALETTE_LIGHT;
  const tone = label.long ? 'long' : 'short';
  const toneHex = label.long ? tokens.blue : tokens.ember;
  // Web parity: .ticket-map is the sea colour mixed toward the tone (color-mix 14% blue / 10%
  // ember), so the mini-map keeps its livery in both themes.
  const mapBg =
    tone === 'long' ? mix(palette.sea, tokens.blue, 0.14) : mix(palette.sea, tokens.ember, 0.1);
  const selectable = onToggle !== undefined;
  const aria = `${label.a} – ${label.b}, ${label.value} ${t('points')}${
    completed ? `, ${t('completed')}` : ''
  }`;

  const cardTheme = { backgroundColor: tokens.surface, borderColor: palette.coast };
  const body = (
    <>
      <View style={[styles.map, { backgroundColor: mapBg, borderBottomColor: palette.coast }]}>
        <RoutePreview
          aId={def.a as string}
          bId={def.b as string}
          toneHex={toneHex}
          palette={palette}
          surface={tokens.surface}
        />
        {label.long && (
          <View style={[styles.flag, { backgroundColor: tokens.blue }]}>
            <Text style={styles.flagText}>{t('longRoute')}</Text>
          </View>
        )}
        {selectable && (
          <View
            style={[
              styles.checkChip,
              { borderColor: tokens.surface },
              selected === true && { backgroundColor: toneHex },
            ]}
          >
            {selected === true && <Check size={12} color="#fff" />}
          </View>
        )}
      </View>
      <View style={styles.foot}>
        <Text style={[styles.route, { color: tokens.ink }]} numberOfLines={1}>
          <Text style={styles.city}>{label.a}</Text>
          <Text style={styles.dash}> — </Text>
          <Text style={styles.city}>{label.b}</Text>
        </Text>
        <View style={[styles.value, { backgroundColor: toneHex }]}>
          <Text style={styles.valueText}>{label.value}</Text>
        </View>
      </View>
      {completed && (
        <View
          style={[styles.doneStamp, { backgroundColor: tokens.surface, borderColor: tokens.ok }]}
        >
          <Check size={26} color={tokens.ok} strokeWidth={3} />
        </View>
      )}
    </>
  );

  if (selectable) {
    return (
      <Pressable
        style={({ pressed }) => [
          styles.card,
          cardTheme,
          selected === true && { borderColor: toneHex, borderWidth: 2 },
          disabled === true && styles.locked,
          pressed && disabled !== true && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected: selected === true, disabled: disabled === true }}
        accessibilityLabel={aria}
        disabled={disabled === true}
        onPress={() => onToggle(ticketId)}
      >
        {body}
      </Pressable>
    );
  }
  return (
    <View
      style={[styles.card, cardTheme, completed === true && styles.completed]}
      accessibilityRole="image"
      accessibilityLabel={aria}
    >
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 150,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  completed: { opacity: 0.55 },
  locked: { opacity: 0.6 },
  pressed: { opacity: 0.8 },
  // Web parity: .ticket-card is 150px wide with a 158px-tall .ticket-map, so the mini-map keeps
  // the same portrait 150:158 proportions here at whatever width the card renders.
  map: {
    aspectRatio: 150 / 158,
    borderBottomWidth: 1,
    borderStyle: 'dashed',
  },
  flag: {
    position: 'absolute',
    top: 5,
    left: 5,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  flagText: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  // Web parity: .ticket-check is a surface-ringed chip over a neutral dark wash.
  checkChip: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    backgroundColor: 'rgba(0,0,0,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 6,
  },
  route: { flex: 1, fontSize: 12 },
  city: { fontWeight: '700' },
  dash: { opacity: 0.5 },
  value: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  doneStamp: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
