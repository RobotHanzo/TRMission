// The player's kept mission cards, each with a route-preview mini-map (ports the web
// TicketPanel). Completed missions sink to the bottom of the deck; otherwise server order.
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { TicketCard } from './TicketCard';

interface Props {
  ticketIds: string[];
  /** Ids of completed missions — greyed out, checkmarked, and sunk to the bottom. */
  completedIds?: ReadonlySet<string> | undefined;
}

export function TicketPanel({ ticketIds, completedIds }: Props) {
  const { t } = useTranslation();
  if (ticketIds.length === 0) return <Text style={styles.muted}>{t('noTickets')}</Text>;

  const isDone = (id: string): boolean => completedIds?.has(id) ?? false;
  const ordered = [...ticketIds].sort((a, b) => Number(isDone(a)) - Number(isDone(b)));

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {ordered.map((id) => (
        <TicketCard key={id} ticketId={id} completed={isDone(id)} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, paddingHorizontal: 4 },
  muted: { opacity: 0.55, fontSize: 13, padding: 8 },
});
