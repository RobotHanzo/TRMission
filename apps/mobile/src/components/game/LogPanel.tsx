// The action log (ports the web LogPanel): entries from the log store rendered through
// logModel's line taxonomy, names via the roster, colours by seat. Sticks to the tail while
// the reader is at the bottom; scrolling up detaches and offers a jump-to-latest chip instead
// (a virtualized FlatList, so long games don't render their whole log).
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { EventPerk, type GameSnapshot } from '@trm/proto';
import type { CardColor } from '@trm/shared';
import { useLogStore } from '../../store/log';
import { useGameStore } from '../../store/game';
import { useUi } from '../../store/ui';
import { usePlayerName } from '../../game/playerName';
import { CARD_COLOR_TOKENS, seatColor } from '../../theme/colors';
import { cityName, routeById, ticketLabel } from '../../game/content';
import { eventNameKey } from '../../game/events';
import type { LogEntry } from '../../game/logModel';

const seatOf = (snapshot: GameSnapshot | null, playerId: string | null): number | null => {
  if (!snapshot || !playerId) return null;
  return snapshot.players.find((p) => p.id === playerId)?.seat ?? null;
};

export function LogPanel() {
  const { t } = useTranslation();
  const entries = useLogStore((s) => s.entries);
  const snapshot = useGameStore((s) => s.snapshot);
  const locale = useUi((s) => s.locale);
  const nameOf = usePlayerName();
  const me = snapshot?.you?.playerId ?? null;
  const listRef = useRef<FlatList<LogEntry>>(null);
  // Stick to the latest entry only while the reader is AT the bottom — scrolling up to re-read
  // must never be yanked back down. A detached reader gets the jump-to-latest chip instead.
  const atBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);

  useEffect(() => {
    if (atBottom.current) listRef.current?.scrollToEnd({ animated: false });
    else setShowJump(true);
  }, [entries.length]);

  const routeName = (id: string): string => {
    const r = routeById.get(id);
    return r ? `${cityName(r.a as string, locale)}–${cityName(r.b as string, locale)}` : id;
  };

  const lineText = (e: LogEntry): string => {
    const seat = seatOf(snapshot, e.playerId);
    const name =
      e.playerId === null
        ? ''
        : nameOf({ id: e.playerId, seat: seat ?? 0, isMe: e.playerId === me });
    switch (e.kind) {
      case 'gameStarted':
        return t('log.gameStarted');
      case 'gameEnded':
        return t('log.gameEnded');
      case 'playerLeft':
        return t('log.playerLeft', { name });
      case 'playerReconnected':
        return t('log.playerReconnected', { name });
      case 'botTookOver':
        return t('log.botTookOver', { name });
      case 'seatReclaimed':
        return t('log.seatReclaimed', { name });
      case 'turnStarted':
        return t('log.turnStarted', { name });
      case 'routeClaimed':
        return t('log.routeClaimed', {
          name,
          route: routeName(String(e.data.routeId)),
          points: e.data.points,
        });
      case 'brokenRailRepaired':
        return t('log.brokenRailRepaired', {
          name,
          route: routeName(String(e.data.routeId)),
          points: e.data.points,
        });
      case 'stationBuilt':
        return t('log.stationBuilt', { name, city: cityName(String(e.data.cityId), locale) });
      case 'tunnelRevealed':
        return t('log.tunnelRevealed', { name, route: routeName(String(e.data.routeId)) });
      case 'tunnelCommitted':
        return t('log.tunnelCommitted', { name, route: routeName(String(e.data.routeId)) });
      case 'tunnelAborted':
        return t('log.tunnelAborted', { name, route: routeName(String(e.data.routeId)) });
      case 'drewBlind':
        return t('log.drewBlind', { name });
      case 'tookFaceup':
        return t('log.tookFaceup', { name });
      case 'ticketsKept':
        return t('log.ticketsKept', { name, count: Number(e.data.count) });
      case 'passed':
        return t('log.passed', { name });
      case 'endgame':
        return e.data.reason === 'DEADLOCK'
          ? t('log.endgameDeadlock')
          : t('log.endgame', { turns: e.data.turns });
      case 'eventAnnounced':
        return t('log.eventAnnounced', { event: t(eventNameKey(String(e.data.eventKind))) });
      case 'eventStarted':
        return t('log.eventStarted', { event: t(eventNameKey(String(e.data.eventKind))) });
      case 'eventEnded':
        return t('log.eventEnded', { event: t(eventNameKey(String(e.data.eventKind))) });
      case 'eventBonus':
        return t(`log.eventBonus.${String(e.data.reason)}`, {
          points: Number(e.data.points),
          city: e.data.cityId ? cityName(String(e.data.cityId), locale) : '',
          route: e.data.routeId ? routeName(String(e.data.routeId)) : '',
        });
      case 'eventMarkerMoved':
        return t('log.eventMarkerMoved', {
          event: t(eventNameKey(String(e.data.eventKind))),
          city: cityName(String(e.data.cityId), locale),
        });
      case 'eventNightMarketSwapped':
        return t('log.eventNightMarketSwapped', { name });
      case 'eventPerkChosen': {
        const perk = Number(e.data.perk);
        const perkName =
          perk === EventPerk.CLAIM_DISCOUNT
            ? t('events.perkClaimDiscount')
            : perk === EventPerk.DRAW_TWO
              ? t('events.perkDrawTwo')
              : t('events.perkRepairPermit');
        return t('log.eventPerkChosen', { name, perk: perkName });
      }
      case 'eventHiveResolved':
        return e.data.busted
          ? t('log.eventHiveBusted', { name })
          : t('log.eventHiveKept', { name, count: Number(e.data.keptCount) });
      case 'marketRecycled':
        return t(`log.marketRecycled.${String(e.data.reason || 'THREE_LOCOS')}`);
      case 'ticketCompleted': {
        const label = ticketLabel(String(e.data.ticketId), locale);
        return label
          ? t('log.ticketCompleted', {
              name,
              from: label.a,
              to: label.b,
              points: label.value,
            })
          : '';
      }
    }
  };

  const renderLine = ({ item: e }: { item: LogEntry }): React.JSX.Element => {
    const seat = seatOf(snapshot, e.playerId);
    const color = e.data.color as CardColor | null | undefined;
    return (
      <View style={styles.line}>
        {seat !== null && <View style={[styles.dot, { backgroundColor: seatColor(seat) }]} />}
        <Text
          style={[
            styles.text,
            e.importance === 'highlight' && styles.highlight,
            e.importance === 'alert' && styles.alert,
          ]}
        >
          {lineText(e)}
        </Text>
        {e.kind === 'tookFaceup' && color && (
          <View
            style={[styles.chip, { backgroundColor: CARD_COLOR_TOKENS[color].hex }]}
            accessibilityLabel={CARD_COLOR_TOKENS[color].nameZh}
          />
        )}
      </View>
    );
  };

  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>{t('log.heading')}</Text>
      {entries.length === 0 ? (
        <Text style={styles.empty}>{t('log.empty')}</Text>
      ) : (
        <FlatList
          ref={listRef}
          style={styles.list}
          data={entries}
          keyExtractor={(e) => String(e.id)}
          renderItem={renderLine}
          onScroll={(ev) => {
            const { contentOffset, contentSize, layoutMeasurement } = ev.nativeEvent;
            const stuck = contentOffset.y + layoutMeasurement.height >= contentSize.height - 24;
            atBottom.current = stuck;
            if (stuck) setShowJump(false);
          }}
          scrollEventThrottle={64}
        />
      )}
      {showJump && (
        <Pressable
          testID="log-jump-latest"
          accessibilityRole="button"
          style={styles.jumpChip}
          onPress={() => {
            atBottom.current = true;
            setShowJump(false);
            listRef.current?.scrollToEnd({ animated: true });
          }}
        >
          <Text style={styles.jumpText}>{t('log.jumpToLatest')}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, gap: 4, minHeight: 80 },
  heading: { fontSize: 13, fontWeight: '700' },
  list: { flex: 1 },
  empty: { fontSize: 12, opacity: 0.55, paddingVertical: 4 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 2,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  text: { flexShrink: 1, fontSize: 12, color: '#374151' },
  highlight: { fontWeight: '700', color: '#1f2328' },
  alert: { fontWeight: '700', color: '#b3261e' },
  chip: {
    width: 12,
    height: 12,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.25)',
  },
  jumpChip: {
    position: 'absolute',
    bottom: 6,
    alignSelf: 'center',
    backgroundColor: '#0f5fa6',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  jumpText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
