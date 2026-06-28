import { useEffect, useRef } from 'react';
import type { GameSnapshot } from '@trm/proto';
import { useGame } from '../store/game';
import { useAnimations } from '../store/animations';
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
  const snapshot = useGame((s) => s.snapshot);
  const lastBatch = useGame((s) => s.lastBatch);
  const pushIntent = useAnimations((s) => s.pushIntent);

  const prevCompleted = useRef<Map<string, Set<string>>>(new Map());
  const seeded = useRef(false);
  const seenBatchSeq = useRef(0);

  // Event-driven intents (claim glow, draws, turn cue, market flip, score floats).
  useEffect(() => {
    if (!lastBatch || lastBatch.seq === seenBatchSeq.current) return;
    seenBatchSeq.current = lastBatch.seq;
    const snap = useGame.getState().snapshot;
    if (!snap) return;
    for (const intent of intentsFromEvents(snap, lastBatch.events)) pushIntent(intent);
  }, [lastBatch, pushIntent]);

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
