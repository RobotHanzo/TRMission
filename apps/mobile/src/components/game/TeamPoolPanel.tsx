// The team's public card pool — the only channel partners may pass cards through, since hands stay
// secret even from a teammate (ports the web TeamPoolPanel). Rendered for every viewer including
// spectators: the pool is open information by design, which is what makes it a signalling device.
// Legality mirrors the reducer via @trm/client-core/game/teams, so controls disable rather than
// letting the server reject.
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Users } from 'lucide-react-native';
import type { GameSnapshot } from '@trm/proto';
import { CARD_COLORS, type CardColor } from '@trm/shared';
import {
  canPushToPool,
  canTakeFromPool,
  isTeamGame,
  myTeamPool,
} from '@trm/client-core/game/teams';
import { handFromCounts } from '../../game/payments';
import { useTheme } from '../../theme/useTheme';
import { useUi } from '../../store/ui';
import { teamColor } from '../../theme/colors';
import { CardRowScroll } from './CardRowScroll';
import { TrainCarCard } from './TrainCarCard';

interface Props {
  snapshot: GameSnapshot;
  onPush(color: CardColor): void;
  onTake(color: CardColor): void;
}

export function TeamPoolPanel({ snapshot, onPush, onTake }: Props): React.JSX.Element | null {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const colorBlind = useUi((s) => s.colorBlind);

  if (!isTeamGame(snapshot)) return null;
  const pool = myTeamPool(snapshot);
  if (!pool) return null;

  const hand = handFromCounts(snapshot.you?.hand);
  const pushUsed = snapshot.you?.teamPushUsed ?? false;
  const full = pool.count >= pool.capacity;
  const hint = pushUsed
    ? t('game.teamPoolPushUsed')
    : full
      ? t('game.teamPoolFull')
      : t('game.teamPoolHint');

  const inPool = CARD_COLORS.filter((c) => pool.cards[c] > 0);
  const spare = CARD_COLORS.filter((c) => hand[c] > 0);

  return (
    <View style={[styles.wrap, { borderColor: tokens.line }]}>
      <View style={styles.head}>
        <Users size={14} color={teamColor(pool.team)} />
        <Text style={[styles.title, { color: teamColor(pool.team) }]}>{t('game.teamPool')}</Text>
        <Text style={[styles.count, { color: tokens.inkSoft }]}>
          {t('game.teamPoolCount', { n: pool.count, max: pool.capacity })}
        </Text>
      </View>

      {inPool.length === 0 ? (
        <Text style={[styles.muted, { color: tokens.inkSoft }]}>{t('game.teamPoolEmpty')}</Text>
      ) : (
        <CardRowScroll contentContainerStyle={styles.row}>
          {inPool.map((c) => {
            const enabled = canTakeFromPool(snapshot, c);
            return (
              <Pressable
                key={c}
                accessibilityRole="button"
                accessibilityLabel={`${t('game.teamPoolTake')}: ${c}`}
                accessibilityState={{ disabled: !enabled }}
                disabled={!enabled}
                onPress={() => onTake(c)}
                style={!enabled && styles.disabled}
              >
                <TrainCarCard color={c} count={pool.cards[c]} showGlyph={colorBlind} />
              </Pressable>
            );
          })}
        </CardRowScroll>
      )}

      <Text style={[styles.muted, { color: tokens.inkSoft }]}>{hint}</Text>
      {spare.length > 0 && (
        <CardRowScroll contentContainerStyle={styles.row}>
          {spare.map((c) => {
            const enabled = canPushToPool(snapshot, c);
            return (
              <Pressable
                key={c}
                accessibilityRole="button"
                accessibilityLabel={`${t('game.teamPoolPush')}: ${c}`}
                accessibilityState={{ disabled: !enabled }}
                disabled={!enabled}
                onPress={() => onPush(c)}
                style={[styles.push, !enabled && styles.disabled]}
              >
                <TrainCarCard color={c} count={hand[c]} showGlyph={colorBlind} />
              </Pressable>
            );
          })}
        </CardRowScroll>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: 10, padding: 8, gap: 6, marginTop: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontWeight: '700', fontSize: 13 },
  count: { marginLeft: 'auto', fontSize: 12 },
  row: { gap: 6, alignItems: 'center' },
  muted: { fontSize: 11 },
  push: { transform: [{ scale: 0.85 }] },
  disabled: { opacity: 0.4 },
});
