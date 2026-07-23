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
 * The seat cap a room needs for a given team mode: its free-for-all ceiling (`baseMaxPlayers`)
 * raised to fit the largest table any of the chosen team count's layouts can require (0 teams ⇒
 * just the ceiling, since no layout matches). The single definition of this rule, shared by the
 * server (which stores it as the room's live `maxPlayers`) and the lobby UI (which uses it to
 * predict whether switching modes would strand already-seated players). Recomputed from the base
 * every time — never grown monotonically — so leaving a team mode restores the ceiling.
 */
export const effectiveMaxPlayers = (baseMaxPlayers: number, teamCount: number): number =>
  TEAM_LAYOUTS.filter((l) => l.teamCount === teamCount).reduce(
    (max, l) => Math.max(max, l.playerCount),
    baseMaxPlayers,
  );

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

/**
 * The lobby team-selector's one seat-swap primitive: the new seat order (userId per seat, index
 * = seat) after moving `userId` onto `targetTeam`, achieved by swapping seats with that team's
 * lowest-seat current occupant (any occupant works — `teamOfSeat` is what defines membership, not
 * which specific seat within the team). Reused three ways: the lobby's self-join endpoint (server
 * authoritative), and host-assign mode's tap-to-place handler on both clients (which then submits
 * the result through the existing host-only reseat call).
 *
 * Returns null if `userId` is already on `targetTeam`, or if no seat currently belongs to it
 * (fewer members seated than `teamCount`, so that residue class is empty) — both are no-ops for
 * the caller to handle distinctly (e.g. "already there" vs "nobody to swap with" for self-join).
 */
export function seatOrderMovingToTeam(
  members: readonly { userId: string; seat: number }[],
  userId: string,
  targetTeam: number,
  teamCount: number,
): string[] | null {
  const me = members.find((m) => m.userId === userId);
  if (!me || teamOfSeat(me.seat, teamCount) === targetTeam) return null;
  const partner = members
    .filter((m) => teamOfSeat(m.seat, teamCount) === targetTeam)
    .sort((a, b) => a.seat - b.seat)[0];
  if (!partner) return null;
  return members
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((m) => {
      if (m.userId === userId) return partner.userId;
      if (m.userId === partner.userId) return userId;
      return m.userId;
    });
}

/**
 * A random full reseat (Fisher–Yates) — the lobby's "shuffle teams" button. `Math.random` is
 * fine here: this is UI-triggered lobby cosmetics, not `@trm/engine` (which is structurally
 * banned from unseeded randomness for replay determinism; that constraint doesn't apply here).
 */
export function shuffleSeatOrder(members: readonly { userId: string }[]): string[] {
  const order = members.map((m) => m.userId);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j] as string, order[i] as string];
  }
  return order;
}
