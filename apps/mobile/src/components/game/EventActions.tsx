// Interactive affordances for the 13-event expansion (ports the web GameStage's inline event
// controls). Two surfaces, both derived exclusively from the snapshot so the offered choices
// always agree with the server's validation:
//  - EventPhaseBar: the blocking event phases (lantern relocation / rolling-stock draft / hive
//    push-your-luck), rendered above the board so the required choice is never buried in a dock.
//  - EventTurnActions: the optional whole/free-turn event actions (start a hive draw, the
//    night-market swap, repairing a slope-closed route), rendered with the draw controls.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CardColor as PbCardColor, Phase, type GameSnapshot } from '@trm/proto';
import { CARD_COLORS, type CardColor } from '@trm/shared';
import { cityName, routeById } from '../../game/content';
import { handFromCounts } from '../../game/payments';
import { hasActiveEvent } from '../../game/events';
import { pbToCard } from '../../game/cards';
import type { EventPerkChoice, GameCommands } from '../../net/commands';
import type { Locale } from '../../net/rest';
import { RADIUS, useTheme } from '../../theme/useTheme';
import { rgba } from '../../theme/shade';
import { CardSwatch } from './CardSwatch';
import { TrainCarCard } from './TrainCarCard';

interface PhaseBarProps {
  snapshot: GameSnapshot;
  commands: GameCommands | null;
  locale: Locale;
}

const PERKS: readonly { perk: EventPerkChoice; labelKey: string }[] = [
  { perk: 'CLAIM_DISCOUNT', labelKey: 'events.perkClaimDiscount' },
  { perk: 'DRAW_TWO', labelKey: 'events.perkDrawTwo' },
  { perk: 'REPAIR_PERMIT', labelKey: 'events.perkRepairPermit' },
];

/** The blocking event-phase prompt (or null while no event phase is pending). */
export function EventPhaseBar({ snapshot, commands, locale }: PhaseBarProps) {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  // Floats over the board on compact - a solid surface card with an ember accent border, so the
  // required choice stays legible on the map.
  const barStyle = [
    styles.bar,
    {
      backgroundColor: tokens.surface,
      borderColor: rgba(tokens.ember, 0.55),
      shadowColor: tokens.ink,
    },
  ];
  const btnWash = { backgroundColor: rgba(tokens.blue, 0.12) };
  const btnInk = { color: tokens.blue };
  const me = snapshot.you?.playerId ?? null;
  const ev = snapshot.randomEvents;
  const phase = snapshot.phase;

  const lanternPending = ev?.lanternPendingRelocation;
  const draft = ev?.eventDraft;
  const hive = ev?.pendingHiveDraw;

  if (phase === Phase.LANTERN_RELOCATION && lanternPending) {
    const mine = lanternPending.playerId === me && !!commands;
    return (
      <View style={barStyle} accessibilityRole="menu" testID="event-phase-bar">
        <Text style={[styles.barTitle, { color: tokens.ink }]}>
          {t('events.relocationRequired')}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.barRow}>
            {lanternPending.candidateCityIds.map((cityId) => (
              <Pressable
                key={cityId}
                style={({ pressed }) => [
                  styles.btn,
                  btnWash,
                  !mine && styles.btnDisabled,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                disabled={!mine}
                onPress={() => commands?.relocateLanternHost(cityId)}
              >
                <Text style={[styles.btnText, btnInk]}>{cityName(cityId, locale)}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>
    );
  }

  if (phase === Phase.EVENT_DRAFT && draft) {
    const mine = draft.currentPlayerId === me && !!commands;
    return (
      <View style={barStyle} accessibilityRole="menu" testID="event-phase-bar">
        <Text style={[styles.barTitle, { color: tokens.ink }]}>
          {t('events.ROLLING_STOCK_ALLOCATION_DAY.name')}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.barRow}>
            {PERKS.map(({ perk, labelKey }) => (
              <Pressable
                key={perk}
                style={({ pressed }) => [
                  styles.btn,
                  btnWash,
                  !mine && styles.btnDisabled,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityHint={t(`${labelKey}Desc`)}
                disabled={!mine}
                onPress={() => commands?.chooseEventPerk(perk)}
              >
                <Text style={[styles.btnText, btnInk]}>{t(labelKey)}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>
    );
  }

  if (phase === Phase.HIVE_DRAW && hive) {
    const mine = hive.playerId === me && !!commands;
    return (
      <View style={barStyle} accessibilityRole="menu" testID="event-phase-bar">
        <Text style={[styles.barTitle, { color: tokens.ink }]}>
          {t('events.hiveTitle')} {hive.revealed.length}/{hive.maxDraws}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.barRow}>
            {hive.revealed.map((card, index) => {
              const color = pbToCard(card);
              return color ? (
                <TrainCarCard key={`${card}-${index}`} color={color} count={1} size={42} />
              ) : null;
            })}
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                btnWash,
                !mine && styles.btnDisabled,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              disabled={!mine}
              onPress={() => commands?.continueHiveDraw()}
            >
              <Text style={[styles.btnText, btnInk]}>{t('events.hiveContinue')}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                btnWash,
                !mine && styles.btnDisabled,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              disabled={!mine}
              onPress={() => commands?.stopHiveDraw()}
            >
              <Text style={[styles.btnText, btnInk]}>{t('events.hiveStop')}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    );
  }

  return null;
}

interface TurnActionsProps {
  snapshot: GameSnapshot;
  commands: GameCommands | null;
  /** It's this viewer's turn in AWAIT_ACTION (the same gate as claiming a route). */
  canAct: boolean;
  locale: Locale;
  /** Opens the repair payment picker (ClaimFlow.startRepair). */
  onRepair(routeId: string): void;
}

/** Optional event actions available on the viewer's turn (or null when none apply). */
export function EventTurnActions({
  snapshot,
  commands,
  canAct,
  locale,
  onRepair,
}: TurnActionsProps) {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const btnWash = { backgroundColor: rgba(tokens.blue, 0.12) };
  const btnInk = { color: tokens.blue };
  const [nightGive, setNightGive] = useState<CardColor>('RED');
  const [nightSlot, setNightSlot] = useState(0);

  const ev = snapshot.randomEvents;
  const hand = handFromCounts(snapshot.you?.hand);
  const allSeatsReserved = hasActiveEvent(ev, 'ALL_SEATS_RESERVED');

  const hiveAvailable = canAct && hasActiveEvent(ev, 'HIVE_OF_SPARKS');
  const nightAvailable = canAct && !!ev?.nightMarketSwapAvailable;
  const slopeRoutes = canAct
    ? (ev?.active
        .filter((event) => event.kind === 'SLOPE_REPAIR_ORDER')
        .flatMap((event) => event.routeIds)
        .filter(
          (routeId) =>
            ev.closedRouteIds.includes(routeId) && !ev.repairedRouteIds.includes(routeId),
        ) ?? [])
    : [];

  if (!hiveAvailable && !nightAvailable && slopeRoutes.length === 0) return null;

  // The same defaulting as the web's selects: a stale pick silently falls back to the first
  // currently-valid option instead of sending an illegal swap.
  const nightColors = CARD_COLORS.filter((color) => hand[color] > 0);
  const nightSlots = snapshot.market.flatMap((card, slot) =>
    card && !(allSeatsReserved && card === PbCardColor.LOCOMOTIVE) ? [slot] : [],
  );
  const selectedNightColor = nightColors.includes(nightGive) ? nightGive : nightColors[0];
  const selectedNightSlot = nightSlots.includes(nightSlot) ? nightSlot : nightSlots[0];

  return (
    <View style={styles.turnActions} testID="event-turn-actions">
      {hiveAvailable && (
        <Pressable
          style={({ pressed }) => [styles.btn, btnWash, pressed && styles.pressed]}
          accessibilityRole="button"
          onPress={() => commands?.startHiveDraw()}
        >
          <Text style={[styles.btnText, btnInk]}>{t('events.hiveStart')}</Text>
        </Pressable>
      )}

      {nightAvailable && (
        <View style={styles.nightBlock}>
          <Text style={[styles.nightLabel, { color: tokens.ink }]}>
            {t('events.nightMarketSwap')}
          </Text>
          <View style={styles.chipRow}>
            {nightColors.map((color) => (
              <Pressable
                key={color}
                style={[styles.chip, selectedNightColor === color && { borderColor: tokens.blue }]}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedNightColor === color }}
                onPress={() => setNightGive(color)}
              >
                <CardSwatch color={color} size={26} />
              </Pressable>
            ))}
          </View>
          <View style={styles.chipRow}>
            {nightSlots.map((slot) => (
              <Pressable
                key={slot}
                style={[
                  styles.chip,
                  styles.slotChip,
                  { backgroundColor: rgba(tokens.ink, 0.06) },
                  selectedNightSlot === slot && { borderColor: tokens.blue },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedNightSlot === slot }}
                onPress={() => setNightSlot(slot)}
              >
                <Text style={[styles.slotChipText, { color: tokens.ink }]}>{slot + 1}</Text>
              </Pressable>
            ))}
            <Pressable
              testID="night-swap-submit"
              style={({ pressed }) => [
                styles.btn,
                btnWash,
                (selectedNightColor === undefined || selectedNightSlot === undefined) &&
                  styles.btnDisabled,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              disabled={selectedNightColor === undefined || selectedNightSlot === undefined}
              onPress={() => {
                if (selectedNightColor !== undefined && selectedNightSlot !== undefined)
                  commands?.nightMarketSwap(selectedNightColor, selectedNightSlot);
              }}
            >
              <Text style={[styles.btnText, btnInk]}>{t('events.nightMarketSwap')}</Text>
            </Pressable>
          </View>
        </View>
      )}

      {slopeRoutes.map((routeId) => {
        const route = routeById.get(routeId);
        const endpoints = route
          ? `${cityName(route.a as string, locale)}–${cityName(route.b as string, locale)}`
          : routeId;
        return (
          <Pressable
            key={routeId}
            style={({ pressed }) => [styles.btn, btnWash, pressed && styles.pressed]}
            accessibilityRole="button"
            onPress={() => onRepair(routeId)}
          >
            <Text style={[styles.btnText, btnInk]}>
              {t('events.repairRouteNamed', { route: endpoints })}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    maxWidth: '100%',
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  barTitle: { fontSize: 13, fontWeight: '700' },
  barRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  turnActions: { gap: 8 },
  btn: {
    minHeight: 40,
    borderRadius: 8,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.45 },
  btnText: { fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  nightBlock: { gap: 6 },
  nightLabel: { fontSize: 12, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  chip: { borderRadius: 8, padding: 3, borderWidth: 2, borderColor: 'transparent' },
  slotChip: {
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotChipText: { fontSize: 13, fontWeight: '700' },
});
