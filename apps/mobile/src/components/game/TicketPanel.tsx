// The player's kept mission cards, each with a route-preview mini-map (ports the web
// TicketPanel). Completed missions sink to the bottom of the deck; otherwise server order.
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { CardRowScroll } from './CardRowScroll';
import { TUTORIAL_ANCHORS, useTutorialAnchor } from '../../features/tutorial/targets';
import { useTheme } from '../../theme/useTheme';
import { TicketCard } from './TicketCard';

interface Props {
  ticketIds: string[];
  /** Ids of completed missions — greyed out, checkmarked, and sunk to the bottom. */
  completedIds?: ReadonlySet<string> | undefined;
}

export function TicketPanel({ ticketIds, completedIds }: Props) {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  // The anchor wraps the empty state too — the web's tickets tray exists regardless.
  const anchor = useTutorialAnchor(TUTORIAL_ANCHORS.tickets);

  const isDone = (id: string): boolean => completedIds?.has(id) ?? false;
  const ordered = [...ticketIds].sort((a, b) => Number(isDone(a)) - Number(isDone(b)));

  return (
    <View {...anchor}>
      {ticketIds.length === 0 ? (
        <Text style={[styles.muted, { color: tokens.inkSoft }]}>{t('noTickets')}</Text>
      ) : (
        <CardRowScroll contentContainerStyle={styles.row}>
          {ordered.map((id) => (
            <TicketCard key={id} ticketId={id} completed={isDone(id)} />
          ))}
        </CardRowScroll>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, paddingHorizontal: 4 },
  muted: { fontSize: 13, padding: 8 },
});
