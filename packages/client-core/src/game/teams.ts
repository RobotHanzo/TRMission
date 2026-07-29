import { Phase, type GameSnapshot, type CardCounts } from '@trm/proto';
import type { CardColor } from '@trm/shared';
import { CARD_COLORS } from '@trm/shared';
import { handFromCounts } from './payments';
import { playerLiveTotal } from './tickets';

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

/**
 * Everyone who won. In a team game the result belongs to the TEAM: every member of a first-place
 * team won, including one whose own total is not the table's highest — and the table's top scorer
 * did NOT win if their side lost. So this reads the team ranking, never the individual one; a
 * free-for-all falls back to `ranking[0]`. Mirrors the server's `winnersOf` (`@trm/engine`), which
 * is what the completion archive and history record.
 */
export function winnerIds(snap: GameSnapshot): Set<string> {
  const finals = snap.finalScores;
  if (!finals) return new Set();
  const teams = finals.teams ?? [];
  if (teams.length === 0) return new Set(finals.ranking?.[0]?.playerIds ?? []);
  const first = new Set(finals.teamRanking?.[0]?.teams ?? []);
  return new Set(teams.filter((t) => first.has(t.team)).flatMap((t) => [...t.memberIds]));
}

/** Did the viewer win? The per-viewer read of {@link winnerIds} — false for spectators and
 *  before the scoreboard exists. */
export function viewerWon(snap: GameSnapshot): boolean {
  const me = snap.you?.playerId;
  return me !== undefined && winnerIds(snap).has(me);
}

/**
 * Below this share a segment is too narrow to hold its team name as well as its score, so both
 * clients drop the name there and keep the number — the head already names the leader, and the
 * segment's full readout stays on its tooltip / accessibility label.
 */
export const TALLY_NAME_MIN_SHARE = 0.24;

export interface TeamTallyRow {
  readonly team: number;
  readonly memberIds: readonly string[];
  /** Live total: the sum of its members' `playerLiveTotal` (route points + completed tickets). */
  readonly total: number;
  /** 0–1 share of every point scored so far. Equal shares while nobody has scored. */
  readonly share: number;
  readonly isMine: boolean;
  /** Sole leader. False for everyone while two or more teams are level at the top. */
  readonly isLeading: boolean;
}

export interface TeamTally {
  /** One row per team that has players, in team-id order — the order the tally renders left→right. */
  readonly rows: readonly TeamTallyRow[];
  /** Every point scored so far. 0 before anyone scores, which is what flattens the shares. */
  readonly grandTotal: number;
  /** How far the leader is ahead of second place. 0 when the top is level. */
  readonly lead: number;
  /** The sole leading team id, or null when the top is level. */
  readonly leader: number | null;
}

/**
 * The live team tally: each side's SHARE of the points scored so far, for the always-full stacked
 * bar both clients render in the player pane. Shares — not progress — because this game has no
 * target score to fill toward, so share of the running total is the only quantity such a bar can
 * honestly show. Mid-game totals, so they come from {@link playerLiveTotal} (the same number the
 * player rows show) and not from `finalScores`, which only exists once the game is over.
 *
 * Returns null in a free-for-all. Membership is read off the public player rows rather than
 * `snapshot.teams`, so a spectator's snapshot tallies the same as a seated player's.
 */
export function liveTeamTally(snap: GameSnapshot): TeamTally | null {
  if (!isTeamGame(snap)) return null;
  const byTeam = new Map<number, string[]>();
  for (const p of snap.players) {
    if (p.team < 0) continue;
    const members = byTeam.get(p.team);
    if (members) members.push(p.id);
    else byTeam.set(p.team, [p.id]);
  }
  if (byTeam.size === 0) return null;

  const mine = myTeam(snap);
  const totals = [...byTeam.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([team, memberIds]) => ({
      team,
      memberIds,
      total: memberIds.reduce((sum, id) => sum + playerLiveTotal(snap, id), 0),
    }));

  const grandTotal = totals.reduce((sum, r) => sum + r.total, 0);
  const ranked = [...totals].sort((a, b) => b.total - a.total);
  const lead = ranked.length > 1 ? ranked[0]!.total - ranked[1]!.total : 0;
  const leader = lead > 0 ? ranked[0]!.team : null;

  return {
    rows: totals.map((r) => ({
      ...r,
      share: grandTotal > 0 ? r.total / grandTotal : 1 / totals.length,
      isMine: mine !== null && r.team === mine,
      isLeading: leader !== null && r.team === leader,
    })),
    grandTotal,
    lead,
    leader,
  };
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
