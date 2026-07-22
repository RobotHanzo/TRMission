// The final scoreboard (ports the web ScoreBoard). Three modes: the score sheet (modal), the
// longest-route review (scoreboard hides so the board shows the seat-coloured highlight, with a
// floating bar to return), and inspect-map (dismissed to pan the final board freely). The web's
// <table> becomes per-player stat rows — same data, same view/map affordances, phone-sized.
// Celebration: continuous confetti behind the sheet, plus the web's rate-this-game block
// (per-gameId dedupe, only for online games — the room context is unset offline) + Discord CTA.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Crown, Eye, Map as MapIcon, MessagesSquare, X } from 'lucide-react-native';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { GameSnapshot, PlayerFinal } from '@trm/proto';
import type { RoomMember } from '../../net/rest';
import { api } from '../../net/rest';
import { seatColor, teamColor } from '../../theme/colors';
import { useTheme } from '../../theme/useTheme';
import { rgba } from '../../theme/shade';
import { seatByPlayer } from '../../game/view';
import { teamStandings } from '@trm/client-core/game/teams';
import { usePlayerName } from '../../game/playerName';
import { ticketById } from '../../game/content';
import { getActiveRoomContext } from '../../game/activeRoom';
import { hasRatedGame, markGameRated } from '../../game/ratedGames';
import { openDiscord } from '../../discord';
import { useAnimationsStore } from '../../store/animations';
import { Confetti } from '../celebration/Confetti';
import { StarRating } from './StarRating';
import { TicketCard } from './TicketCard';

const isBot = (id: string): boolean => id.startsWith('bot:');
const ticketValue = (id: string): number => ticketById.get(id)?.value ?? 0;
/** Winner's-crown gold — celebration ink, deliberately the same in both themes. */
const CROWN_GOLD = '#b8860b';
const FEEDBACK_MAX_LEN = 500;

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
  const { tokens } = useTheme();
  const ink = tokens.inkSoft;
  const playerName = usePlayerName();
  const setRouteReveal = useAnimationsStore((s) => s.setRouteReveal);
  const clearRouteReveal = useAnimationsStore((s) => s.clearRouteReveal);

  const [ticketModal, setTicketModal] = useState<TicketModal | null>(null);
  const [viewingMap, setViewingMap] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Rating is an online-game affordance: the room context is only set by GameScreen (never for
  // offline/tutorial sandboxes), matching the web's gameId+roomCode gate.
  const [{ gameId, roomCode }] = useState(getActiveRoomContext);
  const [stars, setStars] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ratingError, setRatingError] = useState(false);
  // null while the dedupe check is in flight — the block renders nothing until it resolves, so
  // an already-rated game never flashes the picker (and vice versa).
  const [alreadyRated, setAlreadyRated] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!gameId) return;
    void hasRatedGame(gameId).then((rated) => {
      if (!cancelled) setAlreadyRated(rated);
    });
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  const submitRating = async (): Promise<void> => {
    if (!gameId || !roomCode || stars === 0) return;
    setSubmitting(true);
    setRatingError(false);
    const text = feedback.trim();
    try {
      await api.submitRating({ gameId, roomId: roomCode, stars, ...(text ? { text } : {}) });
      await markGameRated(gameId);
      setAlreadyRated(true);
    } catch {
      setRatingError(true);
    } finally {
      setSubmitting(false);
    }
  };

  // Always drop any lingering map highlight when the scoreboard unmounts (e.g. leaving the game).
  useEffect(() => () => clearRouteReveal(), [clearRouteReveal]);

  const fs = snapshot.finalScores;
  if (!fs) return null;

  const seats = seatByPlayer(snapshot);
  const winners = new Set(fs.ranking[0]?.playerIds ?? []);
  // Team standings (empty in a free-for-all) — the authoritative result in a team game.
  const teams = teamStandings(snapshot);
  const sorted = [...fs.players].sort((a, b) => b.total - a.total);
  // Only games played with random events carry the ✨ stat — an events-off (or pre-events)
  // game would otherwise show an all-zero column.
  const showEventBonus =
    snapshot.randomEvents !== undefined || fs.players.some((pf) => pf.eventBonus > 0);
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
        <View
          style={[
            styles.reviewInner,
            { backgroundColor: rgba(tokens.surface, 0.95), borderColor: tokens.line },
          ]}
        >
          <MapIcon size={15} color={ink} />
          <Text style={[styles.reviewCaption, { color: tokens.ink }]} numberOfLines={2}>
            {t('longestRouteOf', { name: nameOf(viewingMap) })}
            {pf
              ? ` · ${t('longestDetail', { cars: pf.longestTrailLength, pts: pf.longestBonus })}`
              : ''}
          </Text>
          <Pressable
            style={[styles.primaryBtn, { backgroundColor: tokens.blue }]}
            accessibilityRole="button"
            onPress={backToScores}
          >
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
        <View
          style={[
            styles.reviewInner,
            { backgroundColor: rgba(tokens.surface, 0.95), borderColor: tokens.line },
          ]}
        >
          <MapIcon size={15} color={ink} />
          <Text style={[styles.reviewCaption, { color: tokens.ink }]}>{t('inspectingMap')}</Text>
          <Pressable
            style={[styles.primaryBtn, { backgroundColor: tokens.blue }]}
            accessibilityRole="button"
            onPress={() => setDismissed(false)}
          >
            <Text style={styles.primaryText}>{t('backToScores')}</Text>
          </Pressable>
          <Pressable style={styles.plainBtn} accessibilityRole="button" onPress={onLeave}>
            <Text style={[styles.plainText, { color: tokens.blue }]}>{t('leaveGame')}</Text>
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
        <Confetti active={!ticketModal} />
        <View style={[styles.modal, { backgroundColor: tokens.surface }]}>
          <Text style={[styles.title, { color: tokens.ink }]}>{t('gameOver')}</Text>
          {teams.length > 0 && (
            // Team game: the TEAM result leads — it is the outcome that decides the match. The
            // per-player rows below still show each member's own contribution.
            <View style={styles.teamStandings}>
              {teams.map((row) => (
                <View
                  key={row.team}
                  style={[
                    styles.teamStanding,
                    { borderColor: teamColor(row.team) },
                    row.place === 1 && { backgroundColor: rgba(tokens.blue, 0.1) },
                  ]}
                >
                  <Text style={[styles.teamStandingName, { color: teamColor(row.team) }]}>
                    {t('teamName', { n: row.team + 1 })}
                  </Text>
                  <Text
                    style={[styles.teamStandingMembers, { color: tokens.inkSoft }]}
                    numberOfLines={1}
                  >
                    {row.memberIds.map((id) => nameOf(id)).join(' · ')}
                  </Text>
                  <Text style={[styles.teamStandingTotal, { color: tokens.ink }]}>{row.total}</Text>
                </View>
              ))}
            </View>
          )}
          <ScrollView style={styles.scroll}>
            {sorted.map((pf) => {
              const seat = seatOf(pf.playerId);
              const { completed, failed, gain, loss } = ticketSplit(pf);
              const winner = winners.has(pf.playerId);
              return (
                <View
                  key={pf.playerId}
                  style={[
                    styles.playerRow,
                    { backgroundColor: rgba(tokens.ink, 0.03) },
                    winner && {
                      borderColor: CROWN_GOLD,
                      backgroundColor: rgba(CROWN_GOLD, 0.08),
                    },
                  ]}
                >
                  <View style={styles.playerHead}>
                    <View style={[styles.seatDot, { backgroundColor: seatColor(seat) }]} />
                    {winner && <Crown size={14} color={CROWN_GOLD} />}
                    {isBot(pf.playerId) && <Bot size={13} color={ink} />}
                    <Text style={[styles.playerName, { color: tokens.ink }]} numberOfLines={1}>
                      {nameOf(pf.playerId)}
                    </Text>
                    <Text style={[styles.total, { color: tokens.ink }]}>{pf.total}</Text>
                  </View>
                  <View style={styles.statsRow}>
                    <Text style={[styles.stat, { color: ink }]}>🚆 {pf.routePoints}</Text>
                    <View style={styles.statGroup}>
                      <Text style={[styles.stat, { color: tokens.ok }]}>✅ +{gain}</Text>
                      {completed.length > 0 && (
                        <Pressable
                          style={styles.viewBtn}
                          accessibilityRole="button"
                          accessibilityLabel={t('view')}
                          onPress={() =>
                            setTicketModal({ kind: 'completed', playerId: pf.playerId })
                          }
                        >
                          <Eye size={13} color={ink} />
                        </Pressable>
                      )}
                    </View>
                    <View style={styles.statGroup}>
                      <Text style={[styles.stat, { color: tokens.danger }]}>
                        ❌ {loss > 0 ? `−${loss}` : '0'}
                      </Text>
                      {failed.length > 0 && (
                        <Pressable
                          style={styles.viewBtn}
                          accessibilityRole="button"
                          accessibilityLabel={t('view')}
                          onPress={() => setTicketModal({ kind: 'failed', playerId: pf.playerId })}
                        >
                          <Eye size={13} color={ink} />
                        </Pressable>
                      )}
                    </View>
                    <Text style={[styles.stat, { color: ink }]}>🚉 +{pf.stationBonus}</Text>
                    {showEventBonus && (
                      <Text style={[styles.stat, { color: ink }]}>✨ +{pf.eventBonus}</Text>
                    )}
                    <View style={styles.statGroup}>
                      <Text style={[styles.stat, { color: ink }]}>
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
                          <MapIcon size={13} color={ink} />
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
              <Text style={[styles.rematchTally, { color: ink }]}>
                {t('rematchTally', { count: rematchCount, total: humanMembers.length })}
              </Text>
              <View style={styles.rematchBtns}>
                {onVote && (
                  <Pressable
                    style={[
                      styles.plainBtn,
                      myVote && { backgroundColor: rgba(tokens.ok, 0.14), borderRadius: 8 },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: myVote }}
                    onPress={() => onVote(!myVote)}
                  >
                    <Text style={[styles.plainText, { color: tokens.blue }]}>
                      🔁 {t('wantRematch')}
                    </Text>
                  </Pressable>
                )}
                {isHost === true && onPlayAgain && (
                  <Pressable
                    style={[styles.primaryBtn, { backgroundColor: tokens.blue }]}
                    accessibilityRole="button"
                    onPress={onPlayAgain}
                  >
                    <Text style={styles.primaryText}>{t('playAgain')}</Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}

          {gameId && roomCode && alreadyRated !== null && (
            <View
              style={[styles.ratingBlock, { borderTopColor: tokens.line }]}
              testID="scoreboard-rating"
            >
              <Text style={[styles.ratingLabel, { color: tokens.ink }]}>{t('rateAppPrompt')}</Text>
              {alreadyRated ? (
                <Text style={[styles.ratingThanks, { color: tokens.ok }]}>{t('ratingThanks')}</Text>
              ) : (
                <>
                  <View style={styles.ratingRow}>
                    <StarRating value={stars} onChange={setStars} size={28} disabled={submitting} />
                    <Pressable
                      style={[
                        styles.primaryBtn,
                        { backgroundColor: tokens.blue },
                        (stars === 0 || submitting) && styles.btnDisabled,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: stars === 0 || submitting }}
                      disabled={stars === 0 || submitting}
                      onPress={() => void submitRating()}
                    >
                      <Text style={styles.primaryText}>{t('submitRating')}</Text>
                    </Pressable>
                  </View>
                  {stars > 0 && (
                    <TextInput
                      style={[
                        styles.feedbackInput,
                        { borderColor: tokens.line, color: tokens.ink },
                      ]}
                      value={feedback}
                      onChangeText={setFeedback}
                      maxLength={FEEDBACK_MAX_LEN}
                      placeholder={t('ratingFeedbackPlaceholder')}
                      placeholderTextColor={tokens.inkSoft}
                      editable={!submitting}
                      multiline
                      numberOfLines={3}
                    />
                  )}
                  {ratingError && (
                    <Text style={[styles.ratingError, { color: tokens.danger }]}>
                      {t('ratingSubmitError')}
                    </Text>
                  )}
                </>
              )}
            </View>
          )}

          <Pressable
            style={styles.discordBtn}
            accessibilityRole="button"
            onPress={openDiscord}
            testID="scoreboard-discord"
          >
            <MessagesSquare size={16} color="#fff" />
            <Text style={styles.discordText}>{t('discordCta')}</Text>
          </Pressable>

          <View style={styles.actions}>
            <Pressable
              style={styles.plainBtn}
              accessibilityRole="button"
              onPress={() => setDismissed(true)}
            >
              <Text style={[styles.plainText, { color: tokens.blue }]}>{t('inspectMap')}</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, { backgroundColor: tokens.blue }]}
              accessibilityRole="button"
              onPress={onLeave}
            >
              <Text style={styles.primaryText}>{t('leaveGame')}</Text>
            </Pressable>
          </View>
        </View>

        {ticketModal && modalPlayer && (
          <View style={styles.backdropInner}>
            <View style={[styles.ticketModal, { backgroundColor: tokens.surface }]}>
              <View style={styles.ticketModalHead}>
                <Text style={[styles.ticketModalTitle, { color: tokens.ink }]} numberOfLines={1}>
                  {t(ticketModal.kind === 'completed' ? 'completedTickets' : 'failedTickets')} ·{' '}
                  {nameOf(ticketModal.playerId)}
                </Text>
                <Pressable
                  style={styles.viewBtn}
                  accessibilityRole="button"
                  accessibilityLabel={t('close')}
                  onPress={() => setTicketModal(null)}
                >
                  <X size={16} color={ink} />
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
  teamStandings: { gap: 6, marginBottom: 10 },
  teamStanding: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  teamStandingName: { fontWeight: '700', fontSize: 13 },
  teamStandingMembers: { flex: 1, fontSize: 12 },
  teamStandingTotal: { fontSize: 17, fontWeight: '800' },
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
    padding: 16,
    gap: 10,
  },
  title: { fontSize: 18, fontWeight: '800' },
  scroll: { flexGrow: 0 },
  playerRow: {
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'transparent',
    padding: 10,
    marginBottom: 6,
    gap: 6,
  },
  playerHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  seatDot: { width: 10, height: 10, borderRadius: 5 },
  playerName: { flex: 1, fontSize: 14, fontWeight: '700' },
  total: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  statGroup: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  stat: { fontSize: 12, fontVariant: ['tabular-nums'] },
  viewBtn: { padding: 6 },
  rematchRow: { gap: 6 },
  rematchTally: { fontSize: 12 },
  rematchBtns: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  ratingBlock: {
    gap: 6,
    borderTopWidth: 1,
    paddingTop: 10,
  },
  ratingLabel: { fontSize: 13, fontWeight: '700' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  ratingThanks: { fontSize: 13, fontWeight: '600' },
  feedbackInput: {
    minHeight: 60,
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    fontSize: 13,
    textAlignVertical: 'top',
  },
  ratingError: { fontSize: 12 },
  btnDisabled: { opacity: 0.45 },
  discordBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: '#5865f2',
  },
  discordText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  plainBtn: { paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  plainText: { fontSize: 14, fontWeight: '600' },
  primaryBtn: {
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
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: '100%',
  },
  reviewCaption: { flexShrink: 1, fontSize: 12, fontWeight: '600' },
  ticketModal: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  ticketModalHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ticketModalTitle: { flex: 1, fontSize: 14, fontWeight: '700' },
  ticketGrid: { flexDirection: 'row', gap: 8 },
});
