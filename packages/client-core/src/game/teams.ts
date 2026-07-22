import { Phase, type GameSnapshot, type CardCounts } from '@trm/proto';
import type { CardColor } from '@trm/shared';
import { CARD_COLORS } from '@trm/shared';
import { handFromCounts } from './payments';

/**
 * Team-game view logic — derived ONCE here and rendered by both clients, so web and mobile can
 * never disagree about who is on whose side or what the pool allows. Everything reads from the
 * authoritative snapshot; nothing is inferred locally.
 */

export interface TeamPoolView {
  readonly team: number;
  readonly memberIds: readonly string[];
  readonly cards: Readonly<Record<CardColor, number>>;
  readonly count: number;
  readonly capacity: number;
  readonly isMine: boolean;
}

/** True when this snapshot belongs to a team game. */
export const isTeamGame = (snap: GameSnapshot): boolean => (snap.gameSettings?.teamCount ?? 0) > 0;

/** The viewer's team id, or null (spectator, or a free-for-all game). */
export function myTeam(snap: GameSnapshot): number | null {
  const me = snap.you?.playerId;
  if (me === undefined) return null;
  const row = snap.players.find((p) => p.id === me);
  return row && row.team >= 0 ? row.team : null;
}

/** playerId → team id, for colouring the table. Empty in a free-for-all. */
export function teamByPlayer(snap: GameSnapshot): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of snap.players) if (p.team >= 0) m.set(p.id, p.team);
  return m;
}

/** Are these two players on the same side? False in a free-for-all unless they are the same. */
export function sameTeam(snap: GameSnapshot, a: string, b: string): boolean {
  if (a === b) return true;
  const teams = teamByPlayer(snap);
  const ta = teams.get(a);
  return ta !== undefined && ta === teams.get(b);
}

/** The viewer's teammates (excluding themselves). Empty for spectators and free-for-all games. */
export function myPartners(snap: GameSnapshot): string[] {
  const me = snap.you?.playerId;
  const team = myTeam(snap);
  if (me === undefined || team === null) return [];
  return snap.players.filter((p) => p.team === team && p.id !== me).map((p) => p.id);
}

/**
 * A teammate's kept tickets. These arrive in the owner-addressed `SelfView` (never on the public
 * player rows), so this returns [] for anyone the viewer is not allowed to see.
 */
export function teammateTickets(snap: GameSnapshot, playerId: string): string[] {
  return snap.you?.teammates.find((t) => t.playerId === playerId)?.keptTicketIds ?? [];
}

/** Every team's pool, in team order. Empty in a free-for-all. */
export function teamPools(snap: GameSnapshot): TeamPoolView[] {
  const teams = snap.teams;
  if (!teams) return [];
  const mine = myTeam(snap);
  return teams.pools.map((pool) => {
    const cards = handFromCounts(pool.cards as CardCounts | undefined);
    let count = 0;
    for (const c of CARD_COLORS) count += cards[c];
    return {
      team: pool.team,
      memberIds: pool.memberIds,
      cards,
      count,
      capacity: teams.capacity,
      isMine: mine !== null && pool.team === mine,
    };
  });
}

/** The viewer's own team pool, or null. */
export const myTeamPool = (snap: GameSnapshot): TeamPoolView | null =>
  teamPools(snap).find((p) => p.isMine) ?? null;

/**
 * Can the viewer push `color` into their pool right now? Mirrors the reducer's gates so the UI
 * disables rather than letting the server reject: their turn, AWAIT_ACTION, push unused this turn,
 * pool not full, and the card actually in hand.
 */
export function canPushToPool(snap: GameSnapshot, color: CardColor): boolean {
  const pool = myTeamPool(snap);
  if (!pool || snap.phase !== Phase.AWAIT_ACTION) return false;
  if (snap.you === undefined || snap.currentPlayerId !== snap.you.playerId) return false;
  if (snap.you.teamPushUsed) return false;
  if (pool.count >= pool.capacity) return false;
  return handFromCounts(snap.you.hand)[color] > 0;
}

/**
 * Can the viewer take `color` from their pool right now? Taking is a DRAW, so it is legal on their
 * turn in AWAIT_ACTION (first pick) or DRAWING_CARDS (second pick) — and, exactly like the face-up
 * market, a locomotive may not be taken as the second pick.
 */
export function canTakeFromPool(snap: GameSnapshot, color: CardColor): boolean {
  const pool = myTeamPool(snap);
  if (!pool || snap.you === undefined) return false;
  if (snap.currentPlayerId !== snap.you.playerId) return false;
  if (pool.cards[color] <= 0) return false;
  if (snap.phase === Phase.AWAIT_ACTION) return true;
  return snap.phase === Phase.DRAWING_CARDS && color !== 'LOCOMOTIVE';
}

/** Team totals from the end-game scoreboard, ranked. Empty in a free-for-all. */
export function teamStandings(
  snap: GameSnapshot,
): { team: number; total: number; place: number; memberIds: readonly string[] }[] {
  const finals = snap.finalScores;
  if (!finals || finals.teams.length === 0) return [];
  const placeOf = new Map<number, number>();
  finals.teamRanking.forEach((group, i) => group.teams.forEach((t) => placeOf.set(t, i + 1)));
  return finals.teams
    .map((t) => ({
      team: t.team,
      total: t.total,
      place: placeOf.get(t.team) ?? finals.teamRanking.length + 1,
      memberIds: t.memberIds,
    }))
    .sort((a, b) => a.place - b.place || a.team - b.team);
}
