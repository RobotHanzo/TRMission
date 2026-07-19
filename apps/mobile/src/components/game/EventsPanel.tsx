// Compact card summarising the live random-events state (ports the web EventsPanel). Renders
// ONLY when the snapshot carries a `random_events` block; everything shown derives purely from
// that authoritative projection — active effects, open charters, the one-round forecast, and the
// gala free-station window. Each kind-bearing row opens a modal with the event's description; for
// a route-targeting kind the modal lists the currently-unclaimed affected routes, each tappable
// to pan the board's camera straight to it (via the SpotlightFramer's eventSpotlight).
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Info, X } from 'lucide-react-native';
import type { RandomEventInfo } from '@trm/proto';
import { useGameStore } from '../../store/game';
import { useUi } from '../../store/ui';
import { useAnimationsStore } from '../../store/animations';
import { usePlayerName } from '../../game/playerName';
import { cityName, routeById } from '../../game/content';
import { ownershipMap } from '../../game/view';
import { eventDescKey, eventNameKey, roundsLeft } from '../../game/events';
import { useTheme } from '../../theme/useTheme';
import { rgba } from '../../theme/shade';
import { panelCardStyle, TrayHead } from '../../theme/gameChrome';

export function EventsPanel() {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const snapshot = useGameStore((s) => s.snapshot);
  const locale = useUi((s) => s.locale);
  const nameOf = usePlayerName();
  const setEventSpotlight = useAnimationsStore((s) => s.setEventSpotlight);
  const [infoKind, setInfoKind] = useState<string | null>(null);

  const ev = snapshot?.randomEvents;
  const owned = useMemo(() => (snapshot ? ownershipMap(snapshot) : null), [snapshot]);

  // The resolvable, currently-unclaimed route ids for whichever kind's info modal is open. At
  // most one active/forecast instance of a given kind exists at once, so matching on `kind` is
  // unambiguous.
  const infoRouteIds = useMemo(() => {
    if (!ev || !infoKind) return [];
    const active = ev.active.find((a) => a.kind === infoKind)?.routeIds;
    const raw = active ?? (ev.forecast?.kind === infoKind ? ev.forecast.routeIds : []);
    return raw.filter((rid) => !owned?.has(rid) && routeById.has(rid));
  }, [ev, infoKind, owned]);

  if (!ev) return null;

  const me = snapshot?.you?.playerId ?? null;
  const seatOf = (id: string): number => snapshot?.players.find((p) => p.id === id)?.seat ?? 0;
  const forecast = ev.forecast;

  const affected = (info: RandomEventInfo): string | null => {
    if (info.kind === 'VIRAL_HOTSPOT' && info.cityId) return cityName(info.cityId, locale);
    if (info.kind === 'BENTO_RUSH' && info.cityId)
      return t('events.bentoCity', { city: cityName(info.cityId, locale) });
    if (info.kind === 'STATION_FRONT_NIGHT_MARKET' && info.cityId)
      return t('events.nightMarketCity', { city: cityName(info.cityId, locale) });
    if (info.kind === 'GODDESS_PROCESSION' && info.cityPath.length > 0) {
      const current = info.cityPath[Math.min(info.position, info.cityPath.length - 1)];
      if (current) return t('events.processionAt', { city: cityName(current, locale) });
    }
    if (info.kind === 'HARVEST_FESTIVAL_EXPRESS' && info.region) return info.region;
    if (info.kind === 'SPRING_FESTIVAL_RUSH') return t('events.reversedDirection');
    if (info.routeIds.length > 0) return t('events.affectedRoutes', { n: info.routeIds.length });
    return null;
  };

  const resourcePlayers =
    snapshot?.players.filter(
      (player) =>
        player.bentoTokens > 0 ||
        player.blessings > 0 ||
        player.claimDiscounts > 0 ||
        player.repairPermits > 0,
    ) ?? [];

  const infoButton = (kind: string) => (
    <Pressable
      style={styles.infoBtn}
      accessibilityRole="button"
      accessibilityLabel={t('view')}
      onPress={() => setInfoKind(kind)}
    >
      <Info size={13} color={tokens.inkSoft} />
    </Pressable>
  );

  // Semantic row washes (web parity: ember=active, blue=charter, ok=free, quiet=forecast).
  const rowFree = { backgroundColor: rgba(tokens.ok, 0.1) };
  const rowActive = { backgroundColor: rgba(tokens.ember, 0.1) };
  const rowCharter = { backgroundColor: rgba(tokens.blue, 0.08) };
  const rowForecast = { backgroundColor: rgba(tokens.ink, 0.04) };
  const inkText = { color: tokens.ink };
  const softText = { color: tokens.inkSoft };

  return (
    <View style={[panelCardStyle(tokens), styles.panel]} testID="events-panel">
      <TrayHead
        title={t('events.panelTitle')}
        right={
          <View style={[styles.modeChip, { backgroundColor: rgba(tokens.blue, 0.12) }]}>
            <Text style={[styles.modeChipText, { color: tokens.blue }]}>
              {t(`eventsMode_${ev.mode}`)}
            </Text>
          </View>
        }
      />

      {ev.freeStationAvailable && (
        <View style={[styles.row, rowFree]}>
          <Text style={[styles.rowName, inkText]}>{t('events.freeStation')}</Text>
        </View>
      )}

      {ev.lanternHost && (
        <View style={[styles.row, rowActive]} testID="lantern-host-row">
          <Text style={[styles.rowName, inkText]}>{t(eventNameKey('LANTERN_HOST_CITY'))}</Text>
          <Text style={[styles.rowSummary, softText]}>
            {t('events.hostCity', { city: cityName(ev.lanternHost.cityId, locale) })}
          </Text>
          {infoButton('LANTERN_HOST_CITY')}
        </View>
      )}

      {ev.boringActive && (
        <View style={[styles.row, rowActive]}>
          <Text style={[styles.rowName, inkText]}>{t(eventNameKey('BREAKTHROUGH_BORING_MACHINE'))}</Text>
          <Text style={[styles.rowSummary, softText]}>{t('events.boringActive')}</Text>
          {infoButton('BREAKTHROUGH_BORING_MACHINE')}
        </View>
      )}

      {ev.active.map((info) => {
        const left = roundsLeft(info, ev.roundIndex);
        const summary = affected(info);
        return (
          <View key={info.id} style={[styles.row, rowActive]}>
            <Text style={[styles.rowName, inkText]}>{t(eventNameKey(info.kind))}</Text>
            {summary !== null && <Text style={[styles.rowSummary, softText]}>{summary}</Text>}
            {left !== null && (
              <Text style={[styles.rowRounds, softText]}>{t('events.roundsLeft', { n: left })}</Text>
            )}
            {infoButton(info.kind)}
          </View>
        );
      })}

      {ev.charters.map((c) => (
        <View key={c.id} style={[styles.row, rowCharter]}>
          <Text style={[styles.rowName, inkText]}>
            {t('events.charterOpen', {
              a: cityName(c.cityA, locale),
              b: cityName(c.cityB, locale),
              pts: c.points,
            })}
          </Text>
          {c.wonByPlayerId !== '' && (
            <Text style={[styles.rowSummary, softText]}>
              {t('events.charterWon', {
                name: nameOf({
                  id: c.wonByPlayerId,
                  seat: seatOf(c.wonByPlayerId),
                  isMe: c.wonByPlayerId === me,
                }),
              })}
            </Text>
          )}
          {infoButton('CHARTER_SPECIAL')}
        </View>
      ))}

      {ev.luckyContracts.map((contract) => (
        <View key={contract.eventId} style={[styles.row, rowCharter]}>
          <Text style={[styles.rowName, inkText]}>
            {t('events.luckyPair', {
              a: cityName(contract.cityA, locale),
              b: cityName(contract.cityB, locale),
            })}
          </Text>
          {contract.wonByPlayerId !== '' && (
            <Text style={[styles.rowSummary, softText]}>
              {t('events.charterWon', {
                name: nameOf({
                  id: contract.wonByPlayerId,
                  seat: seatOf(contract.wonByPlayerId),
                  isMe: contract.wonByPlayerId === me,
                }),
              })}
            </Text>
          )}
          {infoButton('LUCKY_TICKET_STUB')}
        </View>
      ))}

      {ev.eventDraft && (
        <View style={[styles.row, rowActive]}>
          <Text style={[styles.rowName, inkText]}>{t('events.draftTitle')}</Text>
          <Text style={[styles.rowSummary, softText]}>
            {t('events.draftProgress', {
              n: Math.max(0, ev.eventDraft.order.length - ev.eventDraft.pickIndex),
            })}
          </Text>
        </View>
      )}

      {ev.pendingHiveDraw && (
        <View style={[styles.row, rowActive]}>
          <Text style={[styles.rowName, inkText]}>{t('events.hiveTitle')}</Text>
          <Text style={[styles.rowSummary, softText]}>
            {t('events.hiveWaiting', {
              name: nameOf({
                id: ev.pendingHiveDraw.playerId,
                seat: seatOf(ev.pendingHiveDraw.playerId),
                isMe: ev.pendingHiveDraw.playerId === me,
              }),
            })}{' '}
            ({ev.pendingHiveDraw.revealed.length}/{ev.pendingHiveDraw.maxDraws})
          </Text>
        </View>
      )}

      {resourcePlayers.map((player) => {
        const counts = [
          player.bentoTokens > 0 ? t('events.bentoTokens', { n: player.bentoTokens }) : null,
          player.blessings > 0 ? t('events.blessings', { n: player.blessings }) : null,
          player.claimDiscounts > 0
            ? t('events.claimDiscounts', { n: player.claimDiscounts })
            : null,
          player.repairPermits > 0 ? t('events.repairPermits', { n: player.repairPermits }) : null,
        ].filter((value): value is string => value !== null);
        return (
          <View key={player.id} style={[styles.row, rowForecast]}>
            <Text style={[styles.rowName, inkText]}>
              {nameOf({ id: player.id, seat: player.seat, isMe: player.id === me })}
            </Text>
            <Text style={[styles.rowSummary, softText]}>{counts.join(' · ')}</Text>
          </View>
        );
      })}

      {forecast && (
        <View style={[styles.row, rowForecast]}>
          <Text style={[styles.rowLabel, softText]}>{t('events.forecast')}</Text>
          <Text style={[styles.rowName, inkText]}>{t(eventNameKey(forecast.kind))}</Text>
          <Text style={[styles.rowSummary, softText]}>{t('events.startsNextRound')}</Text>
          {infoButton(forecast.kind)}
        </View>
      )}

      <Modal
        visible={infoKind !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setInfoKind(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setInfoKind(null)}>
          <Pressable style={[styles.modal, { backgroundColor: tokens.surface }]} onPress={() => undefined}>
            {infoKind !== null && (
              <>
                <View style={styles.modalHead}>
                  <Text style={[styles.modalTitle, inkText]}>{t(eventNameKey(infoKind))}</Text>
                  <Pressable
                    style={styles.infoBtn}
                    accessibilityRole="button"
                    accessibilityLabel={t('close')}
                    onPress={() => setInfoKind(null)}
                  >
                    <X size={16} color={tokens.inkSoft} />
                  </Pressable>
                </View>
                <Text style={[styles.modalDesc, inkText]}>{t(eventDescKey(infoKind))}</Text>
                {infoRouteIds.length > 0 && (
                  <>
                    <Text style={[styles.routeListTitle, inkText]}>{t('events.routeListTitle')}</Text>
                    <ScrollView style={styles.routeList}>
                      {infoRouteIds.map((rid) => {
                        const r = routeById.get(rid);
                        if (!r) return null;
                        return (
                          <Pressable
                            key={rid}
                            style={({ pressed }) => [styles.routeItem, { backgroundColor: rgba(tokens.ink, 0.04) }, pressed && styles.pressed]}
                            accessibilityRole="button"
                            onPress={() => {
                              setEventSpotlight({ kind: 'route', ids: [rid] });
                              setInfoKind(null);
                            }}
                          >
                            <Text style={[styles.routeItemText, inkText]}>
                              {cityName(r.a as string, locale)}–{cityName(r.b as string, locale)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </>
                )}
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 5 },
  modeChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  modeChipText: { fontSize: 11, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  rowLabel: { fontSize: 11, fontWeight: '700', opacity: 0.6 },
  rowName: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  rowSummary: { fontSize: 11, opacity: 0.7 },
  rowRounds: { fontSize: 11, opacity: 0.7, fontVariant: ['tabular-nums'] },
  infoBtn: { marginLeft: 'auto', padding: 6 },
  pressed: { opacity: 0.7 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modal: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '75%',
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  modalHead: { flexDirection: 'row', alignItems: 'center' },
  modalTitle: { fontSize: 16, fontWeight: '700', flex: 1 },
  modalDesc: { fontSize: 13, lineHeight: 19, opacity: 0.85 },
  routeListTitle: { fontSize: 12, fontWeight: '700', marginTop: 4 },
  routeList: { flexGrow: 0 },
  routeItem: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginTop: 4,
  },
  routeItemText: { fontSize: 13 },
});
