import type { SeatIndex } from './enums';

/** Team id — an abstract index like {@link SeatIndex}; the palette is client-side (ADR A11). */
export type TeamIndex = 0 | 1 | 2;

/** Team ids in canonical order. Iterated for deterministic team loops — order is frozen. */
export const TEAM_INDICES: readonly TeamIndex[] = [0, 1, 2];

/**
 * The supported team layouts. A 6-player table is ambiguous (three pairs or two trios), so the
 * layout is an explicit room setting rather than something derived from the player count.
 */
export type TeamLayoutId = 'PAIRS_2' | 'PAIRS_3' | 'TRIOS_2';

export interface TeamLayout {
  readonly id: TeamLayoutId;
  readonly teamCount: number;
  readonly teamSize: number;
  readonly playerCount: number;
}

export const TEAM_LAYOUTS: readonly TeamLayout[] = Object.freeze([
  Object.freeze({ id: 'PAIRS_2', teamCount: 2, teamSize: 2, playerCount: 4 }),
  Object.freeze({ id: 'PAIRS_3', teamCount: 3, teamSize: 2, playerCount: 6 }),
  Object.freeze({ id: 'TRIOS_2', teamCount: 2, teamSize: 3, playerCount: 6 }),
]) as readonly TeamLayout[];

export const teamLayout = (id: TeamLayoutId): TeamLayout =>
  TEAM_LAYOUTS.find((l) => l.id === id) as TeamLayout;

/** Layouts playable at a given seated-player count (empty ⇒ that count cannot be a team game). */
export const layoutsForPlayerCount = (n: number): readonly TeamLayout[] =>
  TEAM_LAYOUTS.filter((l) => l.playerCount === n);

/**
 * A seat's team. Teams are interleaved around the table by construction — seat 0 and seat
 * `teamCount` are partners — so alternation can never be broken by a seat reshuffle, and the
 * lobby's "pick a team" UI is really just "pick a seat".
 */
export const teamOfSeat = (seat: number, teamCount: number): TeamIndex =>
  (seat % teamCount) as TeamIndex;

/** The seats belonging to `team`, ascending, for a table of `playerCount`. */
export const seatsOfTeam = (
  team: TeamIndex,
  teamCount: number,
  playerCount: number,
): SeatIndex[] => {
  const out: SeatIndex[] = [];
  for (let seat = team; seat < playerCount; seat += teamCount) out.push(seat as SeatIndex);
  return out;
};

/**
 * How many cards a team's face-up pool may hold. The pool is the ONLY channel through which
 * teammates may move cards (hands stay secret), so this cap is what keeps it a signalling
 * device rather than a shared hand.
 */
export const TEAM_POOL_CAPACITY = 4;
