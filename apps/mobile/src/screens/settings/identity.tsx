// The account's avatar, drawn as a station hub: the brand mark's atom (a ring around a core, see
// theme/chrome `RouteGlyph`) scaled up, with the player's initial as the core. Falls back to the
// account's own picture when an OAuth provider gave us one.
import { Image, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/useTheme';

/** First character of the display name, uppercased. CJK names keep their first glyph as-is. */
function initialOf(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? '?';
}

export function AccountAvatar({
  name,
  url,
  size = 40,
}: {
  name: string;
  url?: string | undefined;
  size?: number;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const frame = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: Math.max(2, size * 0.055),
  };
  if (url) {
    return (
      <Image
        source={{ uri: url }}
        accessibilityIgnoresInvertColors
        style={[frame, { borderColor: tokens.brandNavy }]}
      />
    );
  }
  return (
    <View
      style={[
        styles.hub,
        frame,
        { backgroundColor: tokens.surface2, borderColor: tokens.brandNavy },
      ]}
    >
      <Text style={[styles.initial, { color: tokens.blue, fontSize: size * 0.42 }]}>
        {initialOf(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hub: { alignItems: 'center', justifyContent: 'center' },
  initial: { fontWeight: '700' },
});
