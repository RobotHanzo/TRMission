// The final scoreboard (ports the web ScoreBoard). Three modes: the score sheet (modal), the
// longest-route review (scoreboard hides so the board shows the seat-coloured highlight, with a
// floating bar to return), and inspect-map (dismissed to pan the final board freely). The web's
// <table> becomes per-player stat rows — same data, same view/map affordances, phone-sized.
// (Confetti lands with Task 10's animation pass.)
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Crown, Eye, Map as MapIcon, X } from 'lucide-react-native';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { GameSnapshot, PlayerFinal } from '@trm/proto';
import type { RoomMember } from '../../net/rest';
import { seatColor } from '../../theme/colors';
import { seatByPlayer } from '../../game/view';
import { usePlayerName } from '../../game/playerName';
import { ticketById } from '../../game/content';
import { useAnimationsStore } from '../../store/animations';
import { TicketCard } from './TicketCard';

const isBot = (id: string): boolean => id.startsWith('bot:');
const ticketValue = (id: string): number => ticketById.get(id)?.value ?? 0;
const INK = '#4b5563';

/** Completed (gains) vs failed (losses) kept tickets, with their point sums. */
function ticketSplit(pf: PlayerFinal): {
  completed: string[];
  failed: string[];
  gain: number;
  loss: number;
} {
  const completedSet = new Set(pf.completedTicketIds);
  const completed = pf.completedTicketIds;
  const failed = pf.keptTicketIds.filter((id) => !completedSet.has(id));
  const gain = completed.reduce((s, id) => s + ticketValue(id), 0);
  const loss = failed.reduce((s, id) => s + ticketValue(id), 0);
  return { completed, failed, gain, loss };
}

type TicketModal = { kind: 'completed' | 'failed'; playerId: string };

export function ScoreBoard({
  snapshot,
  onLeave,
  isHost,
  members,
  onVote,
  onPlayAgain,
}: {
  snapshot: GameSnapshot;
  onLeave(): void;
  isHost?: boolean | undefined;
  members?: RoomMember[] | undefined;
  onVote?: ((wantsRematch: boolean) => void) | undefined;
  onPlayAgain?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const playerName = usePlayerName();
  const setRouteReveal = useAnimationsStore((s) => s.setRouteReveal);
  const clearRouteReveal = useAnimationsStore((s) => s.clearRouteReveal);

  const [ticketModal, setTicketModal] = useState<TicketModal | null>(null);
  const [viewingMap, setViewingMap] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Always drop any lingering map highlight when the scoreboard unmounts (e.g. leaving the game).
  useEffect(() => () => clearRouteReveal(), [clearRouteReveal]);

  const fs = snapshot.finalScores;
  if (!fs) return null;

  const seats = seatByPlayer(snapshot);
  const winners = new Set(fs.ranking[0]?.playerIds ?? []);
  const sorted = [...fs.players].sort((a, b) => b.total - a.total);
  const seatOf = (id: string): number => seats.get(id) ?? 0;
  const nameOf = (id: string): string =>
    playerName({ id, seat: seatOf(id), isMe: id === snapshot.you?.playerId });

  const openMap = (pf: PlayerFinal): void => {
    if (pf.longestTrailRouteIds.length === 0) return;
    setRouteReveal(seatOf(pf.playerId), [...pf.longestTrailRouteIds]);
    setViewingMap(pf.playerId);
  };
  const backToScores = (): void => {
    clearRouteReveal();
    setViewingMap(null);
  };

  // Map-review mode: hide the scoreboard so the board shows the highlighted longest route,
  // leaving only a floating bar to read it and return. The board stays pannable.
  if (viewingMap) {
    const pf = fs.players.find((p) => p.playerId === viewingMap);
    return (
      <View style={styles.reviewBar} pointerEvents="box-none">
        <View style={styles.reviewInner}>
          <MapIcon size={15} color={INK} />
          <Text style={styles.reviewCaption} numberOfLines={2}>
            {t('longestRouteOf', { name: nameOf(viewingMap) })}
            {pf
              ? ` · ${t('longestDetail', { cars: pf.longestTrailLength, pts: pf.longestBonus })}`
              : ''}
          </Text>
          <Pressable style={styles.primaryBtn} accessibilityRole="button" onPress={backToScores}>
            <Text style={styles.primaryText}>{t('backToScores')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Inspect-map mode: the player dismissed the scoreboard to pan/zoom the final board freely.
  if (dismissed) {
    return (
      <View style={styles.reviewBar} pointerEvents="box-none">
        <View style={styles.reviewInner}>
          <MapIcon size={15} color={INK} />
          <Text style={styles.reviewCaption}>{t('inspectingMap')}</Text>
          <Pressable
            style={styles.primaryBtn}
            accessibilityRole="button"
            onPress={() => setDismissed(false)}
          >
            <Text style={styles.primaryText}>{t('backToScores')}</Text>
          </Pressable>
          <Pressable style={styles.plainBtn} accessibilityRole="button" onPress={onLeave}>
            <Text style={styles.plainText}>{t('leaveGame')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const modalPlayer = ticketModal && fs.players.find((p) => p.playerId === ticketModal.playerId);
  const modalIds = modalPlayer
    ? ticketModal.kind === 'completed'
      ? ticketSplit(modalPlayer).completed
      : ticketSplit(modalPlayer).failed
    : [];

  const myVote = members?.find((m) => m.userId === snapshot.you?.playerId)?.wantsRematch ?? false;
  const humanMembers = members?.filter((m) => !m.isBot) ?? [];
  const rematchCount = humanMembers.filter((m) => m.wantsRematch).length;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onLeave}>
      <View style={styles.backdrop}>
        <View style={styles.modal}>
          <Text style={styles.title}>{t('gameOver')}</Text>
          <ScrollView style={styles.scroll}>
            {sorted.map((pf) => {
              const seat = seatOf(pf.playerId);
              const { completed, failed, gain, loss } = ticketSplit(pf);
              const winner = winners.has(pf.playerId);
              return (
                <View key={pf.playerId} style={[styles.playerRow, winner && styles.winnerRow]}>
                  <View style={styles.playerHead}>
                    <View style={[styles.seatDot, { backgroundColor: seatColor(seat) }]} />
                    {winner && <Crown size={14} color="#b8860b" />}
                    {isBot(pf.playerId) && <Bot size={13} color={INK} />}
                    <Text style={styles.playerName} numberOfLines={1}>
                      {nameOf(pf.playerId)}
                    </Text>
                    <Text style={styles.total}>{pf.total}</Text>
                  </View>
                  <View style={styles.statsRow}>
                    <Text style={styles.stat}>🚆 {pf.routePoints}</Text>
                    <View style={styles.statGroup}>
                      <Text style={[styles.stat, styles.gain]}>✅ +{gain}</Text>
                      {completed.length > 0 && (
                        <Pressable
                          style={styles.viewBtn}
                          accessibilityRole="button"
                          accessibilityLabel={t('view')}
                          onPress={() =>
                            setTicketModal({ kind: 'completed', playerId: pf.playerId })
                          }
                        >
                          <Eye size={13} color={INK} />
                        </Pressable>
                      )}
                    </View>
                    <View style={styles.statGroup}>
                      <Text style={[styles.stat, styles.loss]}>
                        ❌ {loss > 0 ? `−${loss}` : '0'}
                      </Text>
                      {failed.length > 0 && (
                        <Pressable
                          style={styles.viewBtn}
                          accessibilityRole="button"
                          accessibilityLabel={t('view')}
                          onPress={() => setTicketModal({ kind: 'failed', playerId: pf.playerId })}
                        >
                          <Eye size={13} color={INK} />
                        </Pressable>
                      )}
                    </View>
                    <Text style={styles.stat}>🚉 +{pf.stationBonus}</Text>
                    <View style={styles.statGroup}>
                      <Text style={styles.stat}>
                        📏{' '}
                        {t('longestDetail', { cars: pf.longestTrailLength, pts: pf.longestBonus })}
                      </Text>
                      {pf.longestTrailRouteIds.length > 0 && (
                        <Pressable
                          style={styles.viewBtn}
                          accessibilityRole="button"
                          accessibilityLabel={t('viewOnMap')}
                          onPress={() => openMap(pf)}
                        >
                          <MapIcon size={13} color={INK} />
                        </Pressable>
                      )}
                    </View>
                  </View>
                </View>
              );
            })}
          </ScrollView>

          {members && snapshot.you && (onVote !== undefined || onPlayAgain !== undefined) && (
            <View style={styles.rematchRow}>
              <Text style={styles.rematchTally}>
                {t('rematchTally', { count: rematchCount, total: humanMembers.length })}
              </Text>
              <View style={styles.rematchBtns}>
                {onVote && (
                  <Pressable
                    style={[styles.plainBtn, myVote && styles.voteOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: myVote }}
                    onPress={() => onVote(!myVote)}
                  >
                    <Text style={styles.plainText}>🔁 {t('wantRematch')}</Text>
                  </Pressable>
                )}
                {isHost === true && onPlayAgain && (
                  <Pressable
                    style={styles.primaryBtn}
                    accessibilityRole="button"
                    onPress={onPlayAgain}
                  >
                    <Text style={styles.primaryText}>{t('playAgain')}</Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}

          <View style={styles.actions}>
            <Pressable
              style={styles.plainBtn}
              accessibilityRole="button"
              onPress={() => setDismissed(true)}
            >
              <Text style={styles.plainText}>{t('inspectMap')}</Text>
            </Pressable>
            <Pressable style={styles.primaryBtn} accessibilityRole="button" onPress={onLeave}>
              <Text style={styles.primaryText}>{t('leaveGame')}</Text>
            </Pressable>
          </View>
        </View>

        {ticketModal && modalPlayer && (
          <View style={styles.backdropInner}>
            <View style={styles.ticketModal}>
              <View style={styles.ticketModalHead}>
                <Text style={styles.ticketModalTitle} numberOfLines={1}>
                  {t(ticketModal.kind === 'completed' ? 'completedTickets' : 'failedTickets')} ·{' '}
                  {nameOf(ticketModal.playerId)}
                </Text>
                <Pressable
                  style={styles.viewBtn}
                  accessibilityRole="button"
                  accessibilityLabel={t('close')}
                  onPress={() => setTicketModal(null)}
                >
                  <X size={16} color={INK} />
                </Pressable>
              </View>
              <ScrollView horizontal contentContainerStyle={styles.ticketGrid}>
                {modalIds.map((id) => (
                  <TicketCard key={id} ticketId={id} completed={ticketModal.kind === 'completed'} />
                ))}
              </ScrollView>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  backdropInner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modal: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '90%',
    borderRadius: 12,
    backgroundColor: '#fffdf8',
    padding: 16,
    gap: 10,
  },
  title: { fontSize: 18, fontWeight: '800' },
  scroll: { flexGrow: 0 },
  playerRow: {
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: 'rgba(0,0,0,0.03)',
    padding: 10,
    marginBottom: 6,
    gap: 6,
  },
  winnerRow: { borderColor: '#b8860b', backgroundColor: 'rgba(184,134,11,0.08)' },
  playerHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  seatDot: { width: 10, height: 10, borderRadius: 5 },
  playerName: { flex: 1, fontSize: 14, fontWeight: '700' },
  total: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  statGroup: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  stat: { fontSize: 12, color: INK, fontVariant: ['tabular-nums'] },
  gain: { color: '#2e7d32' },
  loss: { color: '#b3261e' },
  viewBtn: { padding: 6 },
  rematchRow: { gap: 6 },
  rematchTally: { fontSize: 12, opacity: 0.65 },
  rematchBtns: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  voteOn: { backgroundColor: 'rgba(46,125,50,0.14)', borderRadius: 8 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  plainBtn: { paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  plainText: { fontSize: 14, fontWeight: '600', color: '#1d4ed8' },
  primaryBtn: {
    backgroundColor: '#0f5fa6',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  reviewBar: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    alignItems: 'center',
  },
  reviewInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,253,248,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: '100%',
  },
  reviewCaption: { flexShrink: 1, fontSize: 12, fontWeight: '600' },
  ticketModal: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 12,
    backgroundColor: '#fffdf8',
    padding: 14,
    gap: 8,
  },
  ticketModalHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ticketModalTitle: { flex: 1, fontSize: 14, fontWeight: '700' },
  ticketGrid: { flexDirection: 'row', gap: 8 },
});
