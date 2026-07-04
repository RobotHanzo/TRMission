import { useEffect, useRef } from 'react';
import { Phase, type GameSnapshot } from '@trm/proto';
import { useGameStore, useGameStoreApi } from '../store/game';
import { useAnimationsStore } from '../store/animations';
import { intentsFromEvents } from '../game/animationModel';
import { completedByPlayer, pathForTicket } from '../game/tickets';
import { ticketById } from '../game/content';

/**
 * Single animation driver, mounted once in GameScreen. Two reactions:
 *  - each new event batch → push the event-derived intents;
 *  - each snapshot → diff `completedTickets` per player and fire completion intents for the
 *    newly-finished ones. The first snapshot (or the first after a reset/reconnect) only seeds the
 *    baseline, so resuming a game never replays a stale fanfare.
 */
export function useAnimationDriver(): void {
  const gameStore = useGameStoreApi();
  const snapshot = useGameStore((s) => s.snapshot);
  const lastBatch = useGameStore((s) => s.lastBatch);
  const pushIntent = useAnimationsStore((s) => s.pushIntent);
  const revealMarketSlots = useAnimationsStore((s) => s.revealMarketSlots);
  const showEndgameWarning = useAnimationsStore((s) => s.showEndgameWarning);
  const showEventBanner = useAnimationsStore((s) => s.showEventBanner);
  const pushNotification = useAnimationsStore((s) => s.pushNotification);

  const prevCompleted = useRef<Map<string, Set<string>>>(new Map());
  const seeded = useRef(false);
  const seenBatchSeq = useRef(0);
  const prevPhase = useRef<Phase | null>(null);
  // null until the first snapshot seeds the baseline, so reconnecting into an already-triggered
  // final round never re-pops the warning (mirrors the ticket-completion seeding above).
  const prevEndgame = useRef<boolean | null>(null);

  // Event-driven intents (claim glow, draws, turn cue, market flip, score floats) + random-event
  // cues (start banner, forecast + bonus toasts). Both ride the live batch only — a reconnect's
  // history backfill goes to the log store, never here, so nothing replays on resync.
  useEffect(() => {
    if (!lastBatch || lastBatch.seq === seenBatchSeq.current) return;
    seenBatchSeq.current = lastBatch.seq;
    const snap = gameStore.getState().snapshot;
    if (!snap) return;
    for (const intent of intentsFromEvents(snap, lastBatch.events)) pushIntent(intent);
    for (const e of lastBatch.events) {
      const ev = e.event;
      if (ev.case === 'randomEventStarted') {
        if (ev.value.info) showEventBanner(ev.value.info.kind);
      } else if (ev.case === 'randomEventAnnounced') {
        if (ev.value.info)
          pushNotification({
            variant: 'announced',
            kind: ev.value.info.kind,
            reason: '',
            points: 0,
            cityId: '',
            routeId: '',
          });
      } else if (ev.case === 'randomEventBonus') {
        pushNotification({
          variant: 'bonus',
          kind: ev.value.kind,
          reason: ev.value.reason,
          points: ev.value.points,
          cityId: ev.value.cityId,
          routeId: ev.value.routeId,
        });
      }
    }
  }, [lastBatch, pushIntent, gameStore, showEventBanner, pushNotification]);

  // Ticket completion via snapshot diff (authoritative `completedTickets`).
  useEffect(() => {
    if (!snapshot) {
      seeded.current = false;
      prevCompleted.current = new Map();
      return;
    }
    const curr = completedByPlayer(snapshot);
    if (!seeded.current) {
      seeded.current = true;
      prevCompleted.current = curr;
      return;
    }
    const me = snapshot.you?.playerId ?? null;
    for (const [playerId, tickets] of curr) {
      const prev = prevCompleted.current.get(playerId) ?? EMPTY;
      for (const ticketId of tickets) {
        if (prev.has(ticketId)) continue;
        fireCompletion(snapshot, playerId, ticketId, playerId === me, pushIntent);
      }
    }
    prevCompleted.current = curr;
  }, [snapshot, pushIntent]);

  // Final-round warning: fire once when `endgame.triggered` flips false→true. The trigger's
  // turn-order index resolves to a player id so we can tell the viewer if it was their own doing.
  useEffect(() => {
    if (!snapshot) {
      prevEndgame.current = null;
      return;
    }
    const triggered = snapshot.endgame?.triggered ?? false;
    const prev = prevEndgame.current;
    prevEndgame.current = triggered;
    if (prev === null || prev || !triggered) return; // seed baseline, or no fresh trigger
    const eg = snapshot.endgame!;
    const me = snapshot.you?.playerId ?? null;
    const triggerId = snapshot.turnOrder[eg.triggerPlayerIndex];
    showEndgameWarning(eg.finalTurnsRemaining, !!me && triggerId === me);
  }, [snapshot, showEndgameWarning]);

  // When a draw resolves (phase leaves DRAWING_CARDS), reveal any market slots held face-down.
  useEffect(() => {
    const phase = snapshot?.phase ?? null;
    if (prevPhase.current === Phase.DRAWING_CARDS && phase !== Phase.DRAWING_CARDS) {
      revealMarketSlots();
    }
    prevPhase.current = phase;
  }, [snapshot, revealMarketSlots]);
}

const EMPTY: ReadonlySet<string> = new Set();

function fireCompletion(
  snapshot: GameSnapshot,
  playerId: string,
  ticketId: string,
  isYou: boolean,
  pushIntent: (i: ReturnType<typeof intentsFromEvents>[number]) => void,
): void {
  const def = ticketById.get(ticketId);
  const seat = snapshot.players.find((p) => p.id === playerId)?.seat ?? 0;
  pushIntent({
    kind: 'ticketComplete',
    playerId,
    ticketId,
    isYou,
    long: def?.deck === 'LONG',
    seat,
    path: pathForTicket(snapshot, playerId, ticketId),
  });
  if (def) pushIntent({ kind: 'scoreFloat', playerId, amount: def.value });
}
