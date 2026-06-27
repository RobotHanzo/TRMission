import type { CardColor } from '@trm/shared';
import { CARD_COLORS } from '@trm/shared';
import type { Board } from './board';
import type { GameState } from './types/state';

/**
 * Conservation & exclusivity invariants. Returns a list of violated-invariant messages (empty
 * = healthy). Asserted in dev/tests after every applied action (property-tested) so silent
 * corruption surfaces immediately.
 */
export function checkInvariants(board: Board, state: GameState): string[] {
  const problems: string[] = [];

  // 1. Card conservation (global & per-colour). Cards live in: hands, deck, discard,
  //    non-null market slots, and a pending tunnel's revealed pile.
  const totals: Record<CardColor, number> = Object.fromEntries(
    CARD_COLORS.map((c) => [c, 0]),
  ) as Record<CardColor, number>;
  for (const p of Object.values(state.players)) {
    for (const c of CARD_COLORS) totals[c] += p.hand[c];
  }
  for (const c of state.deck) totals[c] += 1;
  for (const c of CARD_COLORS) totals[c] += state.discard[c];
  for (const slot of state.market) if (slot !== null) totals[slot] += 1;
  if (state.pendingTunnel) for (const c of state.pendingTunnel.revealed) totals[c] += 1;

  for (const c of CARD_COLORS) {
    const expected = c === 'LOCOMOTIVE' ? state.ruleParams.locomotiveCount : state.ruleParams.deckPerColor;
    if (totals[c] !== expected) problems.push(`card conservation: ${c} = ${totals[c]}, expected ${expected}`);
  }

  // 2. Train conservation: trainCars + Σ length of owned routes === start.
  const ownedLen = new Map<string, number>();
  for (const [routeId, cell] of Object.entries(state.ownership)) {
    if ('owner' in cell) {
      const r = board.routeById.get(routeId);
      if (r) ownedLen.set(cell.owner as string, (ownedLen.get(cell.owner as string) ?? 0) + r.length);
    }
  }
  for (const p of Object.values(state.players)) {
    const used = ownedLen.get(p.id as string) ?? 0;
    if (p.trainCars + used !== state.ruleParams.trainCarsStart) {
      problems.push(`train conservation: ${p.id as string} has ${p.trainCars} + ${used} != ${state.ruleParams.trainCarsStart}`);
    }
    if (p.trainCars < 0) problems.push(`negative trains: ${p.id as string}`);
    for (const c of CARD_COLORS) if (p.hand[c] < 0) problems.push(`negative hand card: ${p.id as string} ${c}`);
    if (p.stationsRemaining < 0 || p.stationsRemaining > state.ruleParams.stationsPerPlayer) {
      problems.push(`station count out of range: ${p.id as string}`);
    }
  }

  // 3. Ownership exclusivity: no player owns both edges of a double-route pair.
  for (const [routeId, cell] of Object.entries(state.ownership)) {
    if ('owner' in cell) {
      const sib = board.doubleSibling.get(routeId);
      if (sib) {
        const sc = state.ownership[sib as string];
        if (sc && 'owner' in sc && sc.owner === cell.owner) {
          problems.push(`double-route exclusivity: ${cell.owner as string} owns both ${routeId} and ${sib as string}`);
        }
      }
    }
  }

  // 4. Stations: at most one per city.
  const cities = new Set<string>();
  for (const s of state.stations) {
    if (cities.has(s.cityId as string)) problems.push(`two stations in ${s.cityId as string}`);
    cities.add(s.cityId as string);
  }

  return problems;
}
