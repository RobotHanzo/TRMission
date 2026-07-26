// A player's picture at the table, ringed in their seat colour (ports the web SeatAvatar): the
// account's OAuth photo, a bot or guest glyph, or the initial of their already-resolved,
// already-moderation-masked label. Shared by the tracker rows and the player card — the ring
// carries the same colour as this player's routes on the board.
import { Image, StyleSheet, Text, View } from 'react-native';
import { Bot, UserRound } from 'lucide-react-native';
import type { PlayerAvatar } from '@trm/client-core/game/playerAvatar';
import { seatColor } from '../../theme/colors';
import { useTheme } from '../../theme/useTheme';

export function SeatAvatar({
  avatar,
  seat,
  size = 22,
}: {
  avatar: PlayerAvatar;
  seat: number;
  size?: number;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const glyph = Math.round(size * 0.55);
  const frame = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderColor: seatColor(seat),
  };
  if (avatar.kind === 'photo') {
    return (
      <Image
        source={{ uri: avatar.url }}
        accessibilityIgnoresInvertColors
        style={[styles.frame, frame]}
      />
    );
  }
  return (
    <View style={[styles.frame, styles.center, frame, { backgroundColor: tokens.surface2 }]}>
      {avatar.kind === 'bot' ? (
        <Bot size={glyph} color={tokens.inkSoft} />
      ) : avatar.kind === 'guest' ? (
        <UserRound size={glyph} color={tokens.inkSoft} />
      ) : (
        <Text style={[styles.initial, { color: tokens.inkSoft, fontSize: size * 0.46 }]}>
          {avatar.letter}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderWidth: 2, flexShrink: 0 },
  center: { alignItems: 'center', justifyContent: 'center' },
  initial: { fontWeight: '700' },
});
