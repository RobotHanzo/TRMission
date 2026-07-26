// The in-game player card (issue #14, ports the web PlayerCard): everything the tracker row no
// longer crams in. Rises as a bottom sheet over the board rather than a centred modal, because
// its primary action highlights the player's network on the board — while that highlight is on,
// the sheet collapses to its header so the board is actually readable underneath.
//
// Every value shown is already public on the wire; the derivation lives in @trm/client-core so
// this sheet and the web's docked panel render the same card.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Map as MapIcon, X } from 'lucide-react-native';
import type { GameSnapshot } from '@trm/proto';
import {
  playerCardView,
  isLowOnTrains,
  trainSupplyFraction,
} from '@trm/client-core/game/playerCard';
import { seatColor, teamColor } from '../../theme/colors';
import { useTheme } from '../../theme/useTheme';
import { rgba } from '../../theme/shade';
import { useAnimationsStore } from '../../store/animations';
import { useUi } from '../../store/ui';
import { usePlayerAvatar, usePlayerName } from '../../game/playerName';
import { cityName, ticketLabel } from '../../game/content';
import { SeatAvatar } from './SeatAvatar';
import { PlayerActionSheet, canModerate } from './PlayerActionSheet';

export function PlayerCard({
  snapshot,
  playerId,
  onClose,
}: {
  snapshot: GameSnapshot;
  playerId: string;
  onClose(): void;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const locale = useUi((s) => s.locale);
  const nameOf = usePlayerName();
  const avatarOf = usePlayerAvatar();
  const setRouteReveal = useAnimationsStore((s) => s.setRouteReveal);
  const clearRouteReveal = useAnimationsStore((s) => s.clearRouteReveal);
  const [revealed, setRevealed] = useState(false);
  const [reporting, setReporting] = useState(false);

  // A highlight belongs to the card that turned it on: drop it when the card closes or swaps to
  // another player, so the board can never keep glowing someone else's network.
  useEffect(() => () => clearRouteReveal(), [playerId, clearRouteReveal]);

  const view = playerCardView(snapshot, playerId);
  if (!view) return null;

  const me = snapshot.you?.playerId ?? null;
  const isMe = playerId === me;
  const name = nameOf({ id: playerId, seat: view.seat, isMe });
  const low = isLowOnTrains(view.trainCars);
  const pct = trainSupplyFraction(view.trainCars, view.trainCarsStart);
  const stationCities = view.stationCityIds.map((id) => cityName(id, locale)).join('、');

  const toggleReveal = (): void => {
    if (revealed) {
      clearRouteReveal();
      setRevealed(false);
      return;
    }
    setRouteReveal(view.seat, view.claimedRouteIds);
    setRevealed(true);
  };

  const label = (text: string, extra?: string): React.JSX.Element => (
    <View style={styles.labelRow}>
      <Text style={[styles.label, { color: tokens.inkSoft }]}>{text}</Text>
      {extra !== undefined && (
        <Text style={[styles.public, { color: tokens.inkSoft, borderColor: tokens.line }]}>
          {extra}
        </Text>
      )}
    </View>
  );
  const sectionStyle = [styles.section, { borderTopWidth: 1, borderTopColor: tokens.line }];

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      {/* No scrim: the board stays readable and pannable, so a revealed network can be followed. */}
      <View style={styles.sheetWrap} pointerEvents="box-none">
        <View
          style={[
            styles.sheet,
            { backgroundColor: tokens.surface, borderColor: tokens.line, shadowColor: tokens.ink },
          ]}
          accessibilityViewIsModal
          accessibilityLabel={`${t('playerCard')} · ${name}`}
        >
          <View style={[styles.head, { backgroundColor: tokens.surface2 }]}>
            <SeatAvatar
              avatar={avatarOf({ id: playerId, seat: view.seat, displayName: name })}
              seat={view.seat}
              size={36}
            />
            <View style={styles.who}>
              <View style={styles.nameRow}>
                <Text style={[styles.name, { color: tokens.ink }]} numberOfLines={1}>
                  {name}
                </Text>
                {view.isCurrent && (
                  <View style={[styles.chip, { backgroundColor: tokens.ember }]}>
                    <Text style={styles.chipText}>{t('nowTurn')}</Text>
                  </View>
                )}
                {view.team >= 0 && (
                  <View style={[styles.chip, { backgroundColor: teamColor(view.team) }]}>
                    <Text style={styles.chipText}>{t('teamName', { n: view.team + 1 })}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.meta, { color: tokens.inkSoft }]}>
                {t('seatNumber', { n: view.seat + 1 })}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t('close')}
              testID="player-card-close"
              hitSlop={8}
              style={styles.close}
            >
              <X size={18} color={tokens.inkSoft} />
            </Pressable>
          </View>

          {/* While the network is lit the body folds away — the point of the reveal is the board. */}
          {!revealed && (
            <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
              <View style={styles.section}>
                {label(t('currentScore'))}
                <View style={styles.totalRow}>
                  <Text style={[styles.total, { color: tokens.ink }]}>{view.total}</Text>
                  <Text style={[styles.totalUnit, { color: tokens.inkSoft }]}>{t('points')}</Text>
                </View>
                <LedgerRow
                  label={t('scoreFromRoutes')}
                  value={`${view.routePoints}`}
                  ink={tokens.ink}
                  soft={tokens.inkSoft}
                  line={tokens.line}
                />
                <LedgerRow
                  label={t('completedTickets')}
                  value={`+${view.ticketPoints}`}
                  ink={tokens.ink}
                  soft={tokens.inkSoft}
                  line={tokens.line}
                />
              </View>

              <View style={sectionStyle}>
                {label(t('trainSupply'))}
                <View style={styles.carsRow}>
                  <Text style={[styles.cars, { color: tokens.ink }]}>{view.trainCars}</Text>
                  <Text style={[styles.carsOf, { color: tokens.inkSoft }]}>
                    / {view.trainCarsStart}
                  </Text>
                  {low && (
                    <Text style={[styles.warn, { color: tokens.ember }]}>{t('endgameSoon')}</Text>
                  )}
                </View>
                <View style={[styles.gauge, { backgroundColor: rgba(tokens.ink, 0.08) }]}>
                  <View
                    style={[
                      styles.gaugeFill,
                      {
                        width: `${pct * 100}%`,
                        backgroundColor: low ? tokens.ember : seatColor(view.seat),
                      },
                    ]}
                  />
                </View>
              </View>

              <View style={sectionStyle}>
                <View style={[styles.grid, { borderColor: tokens.line }]}>
                  <GridCell
                    label={t('cards')}
                    value={`${view.handCount}`}
                    ink={tokens.ink}
                    soft={tokens.inkSoft}
                    line={tokens.line}
                  />
                  <GridCell
                    label={t('tickets')}
                    value={`${view.ticketCount}`}
                    ink={tokens.ink}
                    soft={tokens.inkSoft}
                    line={tokens.line}
                  />
                  <GridCell
                    label={t('stations')}
                    value={`${view.stationCityIds.length}`}
                    suffix={` / ${view.stationsTotal}`}
                    ink={tokens.ink}
                    soft={tokens.inkSoft}
                    line={tokens.line}
                    last
                  />
                </View>
              </View>

              <View style={sectionStyle}>
                {label(t('network'))}
                <Text style={[styles.body2, { color: tokens.inkSoft }]}>
                  {t('networkRoutes', { count: view.claimedRouteIds.length })}
                  {' · '}
                  {view.stationCityIds.length > 0
                    ? t('networkStations', { cities: stationCities })
                    : t('networkNoStations')}
                </Text>
                <View style={styles.actionSpacer}>
                  <RevealButton
                    disabled={view.claimedRouteIds.length === 0}
                    label={t('showNetwork')}
                    onPress={toggleReveal}
                    accent={tokens.accent}
                    surface={tokens.surface}
                    line={tokens.line}
                  />
                </View>
              </View>

              <View style={sectionStyle}>
                {label(t('completedTickets'), t('publicInfo'))}
                {view.completedTicketIds.length === 0 ? (
                  <Text style={[styles.body2, { color: tokens.inkSoft }]}>
                    {t('noCompletedTickets')}
                  </Text>
                ) : (
                  view.completedTicketIds.map((id) => {
                    const tl = ticketLabel(id, locale);
                    if (!tl) return null;
                    return (
                      <View key={id} style={styles.ticketRow}>
                        <Text style={[styles.body2, { color: tokens.ink }]}>{tl.a}</Text>
                        {/* The line between the two cities reads as the track that finished it. */}
                        <View style={[styles.ticketRail, { backgroundColor: tokens.line }]} />
                        <Text style={[styles.body2, { color: tokens.ink }]}>{tl.b}</Text>
                        <Text style={[styles.ticketPts, { color: tokens.ok }]}>+{tl.value}</Text>
                      </View>
                    );
                  })
                )}
              </View>

              {view.resources.length > 0 && (
                <View style={sectionStyle}>
                  {label(t('eventResources'))}
                  <Text style={[styles.body2, { color: tokens.inkSoft }]}>
                    {view.resources.map((r) => t(`events.${r.key}`, { n: r.n })).join(' · ')}
                  </Text>
                </View>
              )}

              {canModerate(playerId, me) && (
                <View style={sectionStyle}>
                  <Pressable
                    onPress={() => setReporting(true)}
                    accessibilityRole="button"
                    testID="player-card-report"
                    style={styles.reportBtn}
                  >
                    <Text style={[styles.report, { color: tokens.inkSoft }]}>
                      {t('moderation.reportPlayer')}
                    </Text>
                  </Pressable>
                </View>
              )}
            </ScrollView>
          )}

          {revealed && (
            <View style={[styles.revealBar, { borderTopColor: tokens.line }]}>
              <Text
                style={[styles.body2, styles.revealCaption, { color: tokens.inkSoft }]}
                numberOfLines={1}
              >
                {t('networkRoutes', { count: view.claimedRouteIds.length })}
              </Text>
              <RevealButton
                label={t('hideNetwork')}
                onPress={toggleReveal}
                accent={tokens.accent}
                surface={tokens.surface}
                line={tokens.line}
                on
              />
            </View>
          )}
        </View>
      </View>

      {reporting && (
        <PlayerActionSheet target={{ id: playerId, name }} onClose={() => setReporting(false)} />
      )}
    </Modal>
  );
}

function LedgerRow({
  label,
  value,
  ink,
  soft,
  line,
}: {
  label: string;
  value: string;
  ink: string;
  soft: string;
  line: string;
}): React.JSX.Element {
  return (
    <View style={styles.ledgerRow}>
      <Text style={[styles.body2, { color: soft }]}>{label}</Text>
      <View style={[styles.leader, { backgroundColor: line }]} />
      <Text style={[styles.ledgerValue, { color: ink }]}>{value}</Text>
    </View>
  );
}

function GridCell({
  label,
  value,
  suffix,
  ink,
  soft,
  line,
  last,
}: {
  label: string;
  value: string;
  suffix?: string;
  ink: string;
  soft: string;
  line: string;
  last?: boolean;
}): React.JSX.Element {
  return (
    <View style={[styles.gridCell, !last && { borderRightWidth: 1, borderRightColor: line }]}>
      <Text style={[styles.gridLabel, { color: soft }]}>{label}</Text>
      <Text style={[styles.gridValue, { color: ink }]}>
        {value}
        {suffix !== undefined && <Text style={[styles.gridSuffix, { color: soft }]}>{suffix}</Text>}
      </Text>
    </View>
  );
}

function RevealButton({
  label,
  onPress,
  disabled,
  accent,
  surface,
  line,
  on,
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
  accent: string;
  surface: string;
  line: string;
  on?: boolean;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, selected: !!on }}
      testID="player-card-reveal"
      style={[
        styles.action,
        {
          borderColor: on ? accent : line,
          backgroundColor: on ? accent : surface,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <MapIcon size={14} color={on ? '#fff' : accent} />
      <Text style={[styles.actionText, { color: on ? '#fff' : accent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '68%',
    borderTopWidth: 1,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: 'hidden',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
    elevation: 12,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12 },
  who: { flex: 1, minWidth: 0, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  chip: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  chipText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  meta: { fontSize: 11, letterSpacing: 0.5 },
  close: { padding: 2 },
  body: { flexGrow: 0 },
  bodyContent: { paddingBottom: 8 },
  section: { paddingHorizontal: 12, paddingVertical: 11 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 7 },
  label: { fontSize: 10.5, fontWeight: '600', letterSpacing: 1 },
  public: { fontSize: 10, borderWidth: 1, borderRadius: 999, paddingHorizontal: 6 },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  total: { fontSize: 32, fontWeight: '600', fontVariant: ['tabular-nums'] },
  totalUnit: { fontSize: 12 },
  ledgerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  leader: { flex: 1, height: 1, opacity: 0.7 },
  ledgerValue: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  carsRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginBottom: 7 },
  cars: { fontSize: 20, fontWeight: '600', fontVariant: ['tabular-nums'] },
  carsOf: { fontSize: 12 },
  warn: { marginLeft: 'auto', fontSize: 11, fontWeight: '600' },
  gauge: { height: 6, borderRadius: 3, overflow: 'hidden' },
  gaugeFill: { height: '100%' },
  grid: { flexDirection: 'row', borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  gridCell: { flex: 1, paddingHorizontal: 9, paddingVertical: 7, gap: 1 },
  gridLabel: { fontSize: 10.5 },
  gridValue: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  gridSuffix: { fontSize: 11, fontWeight: '400' },
  body2: { fontSize: 12.5 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
  },
  actionText: { fontSize: 12.5, fontWeight: '600' },
  actionSpacer: { marginTop: 9 },
  revealCaption: { flex: 1 },
  ticketRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 5 },
  ticketRail: { flex: 1, height: 1 },
  ticketPts: { fontSize: 12.5, fontWeight: '600', fontVariant: ['tabular-nums'] },
  reportBtn: { alignSelf: 'flex-end' },
  report: { fontSize: 11.5, textDecorationLine: 'underline' },
  revealBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
});
