// The persistent whose-turn / connection strip (web folds this into its AppHeader; mobile's
// full-bleed stage gets a dedicated slim bar above the board, next to the EventPhaseBar).
// Turn info renders in every mode — it's real information offline and in the tutorial too;
// the connection chip only exists for live sockets (sandbox games have no connection).
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import type { GameSnapshot } from '@trm/proto';
import { turnStatus } from '../../game/view';
import { usePlayerName } from '../../game/playerName';
import { useGameStore } from '../../store/game';
import { RADIUS, useTheme } from '../../theme/useTheme';

export function TurnBanner({
  snapshot,
  sandbox,
}: {
  snapshot: GameSnapshot;
  sandbox?: boolean | undefined;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const nameOf = usePlayerName();
  const status = useGameStore((s) => s.status);

  const turn = turnStatus(snapshot);
  const mine = turn.key === 'yourTurn';
  const text =
    turn.key === 'gameOver'
      ? t('game.over')
      : mine
        ? t('game.yourTurn')
        : t('game.turnOf', {
            name: turn.player ? nameOf({ id: turn.player.id, seat: turn.player.seat }) : '?',
          });

  const showConn = !sandbox && status !== 'open';
  const connText = status === 'closed' ? t('game.disconnected') : t('game.reconnecting');
  const connColor = status === 'closed' ? tokens.danger : tokens.ember;

  return (
    <View
      testID="turn-banner"
      style={[
        styles.row,
        {
          backgroundColor: mine ? tokens.blue : tokens.surface,
          borderColor: mine ? tokens.blue : tokens.line,
          shadowColor: tokens.ink,
        },
      ]}
    >
      <Text
        style={[
          styles.turnText,
          { color: mine ? '#fff' : turn.key === 'gameOver' ? tokens.inkSoft : tokens.ink },
        ]}
        numberOfLines={1}
      >
        {text}
      </Text>
      {showConn && (
        <View testID="turn-banner-conn" style={[styles.connChip, { backgroundColor: connColor }]}>
          <Text style={styles.connText}>{connText}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 7,
    gap: 8,
    // Floats over the board on compact; the soft paper shadow keeps it legible on the map.
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  turnText: { fontSize: 13, fontWeight: '700', flexShrink: 1 },
  connChip: { borderRadius: RADIUS.sm, paddingHorizontal: 8, paddingVertical: 2 },
  connText: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
