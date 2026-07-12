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

const INK = '#4b5563';

export function EventsPanel() {
  const { t } = useTranslation();
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
    if (info.routeIds.length > 0) return t('events.affectedRoutes', { n: info.routeIds.length });
    return null;
  };

  const infoButton = (kind: string) => (
    <Pressable
      style={styles.infoBtn}
      accessibilityRole="button"
      accessibilityLabel={t('view')}
      onPress={() => setInfoKind(kind)}
    >
      <Info size={13} color={INK} />
    </Pressable>
  );

  return (
    <View style={styles.panel} testID="events-panel">
      <View style={styles.head}>
        <Text style={styles.title}>{t('events.panelTitle')}</Text>
        <View style={styles.modeChip}>
          <Text style={styles.modeChipText}>{t(`eventsMode_${ev.mode}`)}</Text>
        </View>
      </View>

      {ev.freeStationAvailable && (
        <View style={[styles.row, styles.rowFree]}>
          <Text style={styles.rowName}>{t('events.freeStation')}</Text>
        </View>
      )}

      {ev.active.map((info) => {
        const left = roundsLeft(info, ev.roundIndex);
        const summary = affected(info);
        return (
          <View key={info.id} style={[styles.row, styles.rowActive]}>
            <Text style={styles.rowName}>{t(eventNameKey(info.kind))}</Text>
            {summary !== null && <Text style={styles.rowSummary}>{summary}</Text>}
            {left !== null && (
              <Text style={styles.rowRounds}>{t('events.roundsLeft', { n: left })}</Text>
            )}
            {infoButton(info.kind)}
          </View>
        );
      })}

      {ev.charters.map((c) => (
        <View key={c.id} style={[styles.row, styles.rowCharter]}>
          <Text style={styles.rowName}>
            {t('events.charterOpen', {
              a: cityName(c.cityA, locale),
              b: cityName(c.cityB, locale),
              pts: c.points,
            })}
          </Text>
          {c.wonByPlayerId !== '' && (
            <Text style={styles.rowSummary}>
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

      {forecast && (
        <View style={[styles.row, styles.rowForecast]}>
          <Text style={styles.rowLabel}>{t('events.forecast')}</Text>
          <Text style={styles.rowName}>{t(eventNameKey(forecast.kind))}</Text>
          <Text style={styles.rowSummary}>{t('events.startsNextRound')}</Text>
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
          <Pressable style={styles.modal} onPress={() => undefined}>
            {infoKind !== null && (
              <>
                <View style={styles.modalHead}>
                  <Text style={styles.modalTitle}>{t(eventNameKey(infoKind))}</Text>
                  <Pressable
                    style={styles.infoBtn}
                    accessibilityRole="button"
                    accessibilityLabel={t('close')}
                    onPress={() => setInfoKind(null)}
                  >
                    <X size={16} color={INK} />
                  </Pressable>
                </View>
                <Text style={styles.modalDesc}>{t(eventDescKey(infoKind))}</Text>
                {infoRouteIds.length > 0 && (
                  <>
                    <Text style={styles.routeListTitle}>{t('events.routeListTitle')}</Text>
                    <ScrollView style={styles.routeList}>
                      {infoRouteIds.map((rid) => {
                        const r = routeById.get(rid);
                        if (!r) return null;
                        return (
                          <Pressable
                            key={rid}
                            style={({ pressed }) => [styles.routeItem, pressed && styles.pressed]}
                            accessibilityRole="button"
                            onPress={() => {
                              setEventSpotlight({ kind: 'route', ids: [rid] });
                              setInfoKind(null);
                            }}
                          >
                            <Text style={styles.routeItemText}>
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
  panel: { gap: 4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 13, fontWeight: '700' },
  modeChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 1,
    backgroundColor: 'rgba(15,95,166,0.12)',
  },
  modeChipText: { fontSize: 11, fontWeight: '600', color: '#0f5fa6' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  rowFree: { backgroundColor: 'rgba(46,125,50,0.10)' },
  rowActive: { backgroundColor: 'rgba(238,107,31,0.10)' },
  rowCharter: { backgroundColor: 'rgba(15,95,166,0.08)' },
  rowForecast: { backgroundColor: 'rgba(0,0,0,0.04)' },
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
    backgroundColor: '#fffdf8',
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
    backgroundColor: 'rgba(0,0,0,0.04)',
    marginTop: 4,
  },
  routeItemText: { fontSize: 13 },
});
