import type { CardColor } from '@trm/shared';
import { drawOne, type RefillResult } from '../deck';
import type { GameState } from '../types/state';
import type { GameEvent } from '../types/events';
import { advanceBoringMarker } from './effects';

/** Draw one real train card and advance the hidden boring-machine marker in lock-step. */
export function drawEventCard(state: GameState): {
  state: GameState;
  card: CardColor | null;
  events: GameEvent[];
} {
  const draw = drawOne(state.deck, state.discard, state.rng);
  let next: GameState = {
    ...state,
    deck: draw.deck,
    discard: draw.discard,
    rng: draw.rng,
  };
  const events: GameEvent[] = [];
  if (draw.reshuffled) events.push({ e: 'DECK_RESHUFFLED', visibility: 'PUBLIC' });
  if (draw.card !== null) {
    const marker = advanceBoringMarker(next, 1);
    next = marker.state;
    if (marker.endedId !== null) {
      events.push({
        e: 'EVENT_ENDED',
        id: marker.endedId,
        kind: 'BREAKTHROUGH_BORING_MACHINE',
        visibility: 'PUBLIC',
      });
    }
  }
  return { state: next, card: draw.card, events };
}

/** Apply a completed market refill to state and account for every real card it drew. */
export function applyEventRefill(
  state: GameState,
  refill: RefillResult,
): { state: GameState; events: GameEvent[] } {
  let next: GameState = {
    ...state,
    market: refill.market,
    deck: refill.deck,
    discard: refill.discard,
    rng: refill.rng,
  };
  const events: GameEvent[] = [];
  if (refill.reshuffled) events.push({ e: 'DECK_RESHUFFLED', visibility: 'PUBLIC' });
  if (refill.recycled) {
    events.push({
      e: 'MARKET_RECYCLED',
      reason: refill.recycleReason ?? 'THREE_LOCOS',
      visibility: 'PUBLIC',
    });
  }
  const marker = advanceBoringMarker(next, refill.drawnCount);
  next = marker.state;
  if (marker.endedId !== null) {
    events.push({
      e: 'EVENT_ENDED',
      id: marker.endedId,
      kind: 'BREAKTHROUGH_BORING_MACHINE',
      visibility: 'PUBLIC',
    });
  }
  return { state: next, events };
}
