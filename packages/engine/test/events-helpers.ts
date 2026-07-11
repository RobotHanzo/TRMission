import type { CardColor, TrainColor, PlayerId, RouteId, CityId } from '@trm/shared';
import { CARD_COLORS } from '@trm/shared';
import type { RouteDef } from '@trm/map-data';
import type { Board } from '../src/board';
import type { GameState, PlayerState } from '../src/types/state';
import type { EventsState, ActiveEvent, RandomEventKind } from '../src/types/events-state';
import type { Payment } from '../src/types/actions';
import { emptyHand } from '../src/hand';
import { makeConfig } from './helpers';
import { initGame } from '../src/setup';
import { reduce } from '../src/reduce';

export type Mode = 'light' | 'moderate' | 'intense';

/** A neutral, feature-on EventsState with no schedule and no live effects. */
export function emptyEvents(mode: Mode = 'light'): EventsState {
  return {
    mode,
    roundIndex: 1,
    nextIdx: 0,
    schedule: [],
    suppressed: [],
    active: [],
    hotspots: {},
    charters: [],
    luckyContracts: [],
    reopenBonus: [],
    repairedRouteIds: [],
    resources: {},
  };
}

/** initGame + resolve every initial ticket offer → AWAIT_ACTION (orderIndex 0, p0 to move). */
export function afterSetup(
  numPlayers: number,
  seed: string,
  mode: Mode = 'light',
): { board: Board; state: GameState } {
  const { board, config } = makeConfig(numPlayers, seed, { eventsMode: mode });
  let state = initGame(board, config);
  while (state.turn.phase === 'SETUP_TICKETS') {
    const pid = state.turnOrder.find((id) => state.players[id as string]?.pendingTicketOffer)!;
    const offer = state.players[pid as string]!.pendingTicketOffer!;
    const res = reduce(board, state, {
      t: 'KEEP_INITIAL_TICKETS',
      player: pid,
      keep: offer.slice(0, state.ruleParams.minKeepInitial),
    });
    if (!res.ok) throw new Error('setup keep failed');
    state = res.value.state;
  }
  return { board, state };
}

export const withEvents = (state: GameState, events: EventsState): GameState => ({
  ...state,
  events,
});

/** A full colour-count hand from a partial spec (missing colours default to 0). */
export function handOf(partial: Partial<Record<CardColor, number>>): Record<CardColor, number> {
  const h = emptyHand();
  for (const c of CARD_COLORS) if (partial[c] !== undefined) h[c] = partial[c] as number;
  return h;
}

/** Build a live ActiveEvent (defaults: a very-late expiry so it stays active for the whole test). */
export function activeEvent(
  kind: RandomEventKind,
  opts: {
    id?: string;
    endsAfterRound?: number;
    routeIds?: readonly RouteId[];
    region?: string;
    cityId?: CityId;
    cityPath?: readonly CityId[];
    position?: number;
  } = {},
): ActiveEvent {
  return {
    id: opts.id ?? kind.toLowerCase(),
    kind,
    endsAfterRound: opts.endsAfterRound ?? 99,
    ...(opts.routeIds ? { routeIds: opts.routeIds } : {}),
    ...(opts.region !== undefined ? { region: opts.region } : {}),
    ...(opts.cityId !== undefined ? { cityId: opts.cityId } : {}),
    ...(opts.cityPath ? { cityPath: opts.cityPath } : {}),
    ...(opts.position !== undefined ? { position: opts.position } : {}),
  };
}

/** Merge a partial patch into one player. */
export function setPlayer(
  state: GameState,
  player: PlayerId,
  patch: Partial<PlayerState>,
): GameState {
  const p = state.players[player as string]!;
  return { ...state, players: { ...state.players, [player as string]: { ...p, ...patch } } };
}

/** Empty every draw source (deck / discard / market / short-ticket deck). */
export function drainPools(state: GameState): GameState {
  return {
    ...state,
    deck: [],
    discard: emptyHand(),
    market: state.market.map(() => null),
    ticketDeckShort: [],
  };
}

/** Total cards across every store (hands, deck, discard, non-null market, revealed tunnel pile). */
export function totalCards(state: GameState): number {
  let n = 0;
  for (const p of Object.values(state.players)) for (const c of CARD_COLORS) n += p.hand[c];
  n += state.deck.length;
  for (const c of CARD_COLORS) n += state.discard[c];
  for (const slot of state.market) if (slot !== null) n += 1;
  if (state.pendingTunnel) n += state.pendingTunnel.revealed.length;
  if (state.events?.pendingHiveDraw) n += state.events.pendingHiveDraw.revealed.length;
  return n;
}

/** A single player's total hand size. */
export function handTotal(state: GameState, player: PlayerId): number {
  const p = state.players[player as string]!;
  let n = 0;
  for (const c of CARD_COLORS) n += p.hand[c];
  return n;
}

/** The colour to pay a route with (its own colour; RED stands in for a GRAY route). */
export function payColorFor(route: RouteDef): TrainColor {
  return route.color === 'GRAY' ? 'RED' : route.color;
}

/** An all-colour (no-loco) payment matching `route`'s length + `extra` surcharge cards. */
export function colorPayment(route: RouteDef, extra = 0): Payment {
  return { color: payColorFor(route), colorCount: route.length + extra, locomotives: 0 };
}
