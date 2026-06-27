import type { PlayerId, CardColor } from '@trm/shared';
import { CARD_COLORS } from '@trm/shared';
import type { GameState, PlayerState, OwnerCell } from '../types/state';
import type { CardCounts } from '../hand';

export function getPlayer(state: GameState, id: PlayerId): PlayerState | undefined {
  return state.players[id as string];
}

export function withPlayer(
  state: GameState,
  id: PlayerId,
  fn: (p: PlayerState) => PlayerState,
): GameState {
  const p = state.players[id as string];
  if (!p) return state;
  return { ...state, players: { ...state.players, [id as string]: fn(p) } };
}

/** Remove a multiset of cards from a player's hand and add them to the discard pile. */
export function spendCards(state: GameState, id: PlayerId, spent: Readonly<CardCounts>): GameState {
  const p = state.players[id as string];
  if (!p) return state;
  const hand = { ...p.hand };
  const discard = { ...state.discard };
  for (const c of CARD_COLORS) {
    if (spent[c]) {
      hand[c] -= spent[c];
      discard[c] += spent[c];
    }
  }
  return {
    ...state,
    discard,
    players: { ...state.players, [id as string]: { ...p, hand } },
  };
}

export function addCardToHand(state: GameState, id: PlayerId, card: CardColor, n = 1): GameState {
  const p = state.players[id as string];
  if (!p) return state;
  const hand = { ...p.hand };
  hand[card] += n;
  return { ...state, players: { ...state.players, [id as string]: { ...p, hand } } };
}

export function setOwnership(state: GameState, routeId: string, cell: OwnerCell): GameState {
  return { ...state, ownership: { ...state.ownership, [routeId]: cell } };
}
