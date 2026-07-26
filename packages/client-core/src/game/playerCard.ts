import type { GameSnapshot } from '@trm/proto';
import { ACTIVE_RULES, ticketById } from './content';

/**
 * The in-game player card's view model (issue #14). The tracker rows carry only the two numbers
 * a player reads at a glance — live score and remaining train cars; everything else is derived
 * HERE, once, and rendered by both clients (web docks a panel over the rail, mobile raises a
 * bottom sheet).
 *
 * Every field comes from data that is already public on the wire: the counts-only
 * `PublicPlayerState`, the public `ownership` / `stations` placements, and `completedTickets`
 * (finished missions are revealed by design — in-progress ones stay secret). Nothing here may
 * read `snapshot.you`; the card renders for opponents too, so a field that needed SelfView would
 * be a hidden-information leak the moment someone opened another player's card.
 */
export interface PlayerCardView {
  playerId: string;
  seat: number;
  /** Team id, or -1 in a free-for-all. */
  team: number;
  isBot: boolean;
  isCurrent: boolean;
  /** Live total: route points + the value of every mission this player has already completed. */
  total: number;
  routePoints: number;
  ticketPoints: number;
  completedTicketIds: string[];
  trainCars: number;
  /** Gauge denominator — the active content's starting train count, not a hardcoded 45. */
  trainCarsStart: number;
  handCount: number;
  ticketCount: number;
  stationCityIds: string[];
  stationsRemaining: number;
  /** Built + remaining, so a custom map's `stationsPerPlayer` needs no separate lookup. */
  stationsTotal: number;
  claimedRouteIds: string[];
  /** Non-zero event resources only, in a stable display order. Keys match the `events.*` i18n
   *  keys both clients already use for the events panel. */
  resources: { key: PlayerResourceKey; n: number }[];
}

export type PlayerResourceKey = 'bentoTokens' | 'blessings' | 'claimDiscounts' | 'repairPermits';

export const isBotPlayer = (id: string): boolean => id.startsWith('bot:');

/** Route ids this player has claimed (their network on the board). */
export function claimedRouteIds(snapshot: GameSnapshot, playerId: string): string[] {
  return snapshot.ownership
    .filter((o) => o.cell.case === 'ownerPlayerId' && o.cell.value === playerId)
    .map((o) => o.routeId);
}

/** Build the card view for one player, or null when the id is not seated in this game. */
export function playerCardView(snapshot: GameSnapshot, playerId: string): PlayerCardView | null {
  const p = snapshot.players.find((x) => x.id === playerId);
  if (!p) return null;

  const completedTicketIds = snapshot.completedTickets
    .filter((c) => c.playerId === playerId)
    .map((c) => c.ticketId);
  const ticketPoints = completedTicketIds.reduce(
    (sum, id) => sum + (ticketById.get(id)?.value ?? 0),
    0,
  );
  const stationCityIds = snapshot.stations
    .filter((s) => s.playerId === playerId)
    .map((s) => s.cityId);

  const resources = (
    [
      ['bentoTokens', p.bentoTokens],
      ['blessings', p.blessings],
      ['claimDiscounts', p.claimDiscounts],
      ['repairPermits', p.repairPermits],
    ] as const
  )
    .filter(([, n]) => n > 0)
    .map(([key, n]) => ({ key, n }));

  return {
    playerId,
    seat: p.seat,
    team: p.team,
    isBot: isBotPlayer(playerId),
    isCurrent: playerId === snapshot.currentPlayerId,
    total: p.routePoints + ticketPoints,
    routePoints: p.routePoints,
    ticketPoints,
    completedTicketIds,
    trainCars: p.trainCars,
    trainCarsStart: ACTIVE_RULES.trainCarsStart,
    handCount: p.handCount,
    ticketCount: p.ticketCount,
    stationCityIds,
    stationsRemaining: p.stationsRemaining,
    stationsTotal: stationCityIds.length + p.stationsRemaining,
    claimedRouteIds: claimedRouteIds(snapshot, playerId),
    resources,
  };
}

/**
 * Remaining rolling stock as a 0–1 fraction — the tracker row's depleting baseline and the
 * card's gauge. Clamped, so content whose rules did not load (or a train count above the
 * authored start) can never overflow the bar.
 */
export function trainSupplyFraction(trainCars: number, trainCarsStart: number): number {
  if (trainCarsStart <= 0) return 0;
  return Math.max(0, Math.min(1, trainCars / trainCarsStart));
}

/**
 * How few train cars count as "the endgame is close" — the row + gauge switch to the warning
 * colour here. Deliberately wider than the engine's `endgameTrainThreshold` (the count that
 * actually *fires* the final round): by the time a player is AT the trigger the warning has no
 * value left, so the cue leads it by a claimable route's worth of cars.
 */
export const LOW_TRAIN_CARS = 5;

export const isLowOnTrains = (trainCars: number): boolean => trainCars <= LOW_TRAIN_CARS;
