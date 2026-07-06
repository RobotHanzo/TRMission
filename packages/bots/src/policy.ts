// The bot brain. `chooseBotAction` ranks every *legal* action (candidates come straight
// from the engine's `legalActions`, so a bot can never emit an illegal move) by a
// difficulty-tuned utility and returns the best one. Three difficulties differ in:
//   • planning  — whether the bot routes toward its destination tickets,
//   • noise      — random jitter that makes weak bots play loosely,
//   • drafting   — whether it draws extra tickets mid-game,
//   • stations    — whether it spends a station to rescue a blocked ticket.
//
// Decisions use only fair information (the bot's own hand/tickets + public board state),
// the same a human client could compute. Picks are a deterministic function of state +
// botId, so behaviour is reproducible (handy for tests); the chosen action is logged like
// any other, so replay/recovery never depends on the policy.
import { legalActions } from '@trm/engine';
import type { Action, Board, GameState } from '@trm/engine';
import { TRAIN_COLORS } from '@trm/shared';
import type { PlayerId, CardColor, TrainColor, TicketId } from '@trm/shared';
import type { BotDifficulty } from './types';

interface Knobs {
  /** 0 = ignore tickets, 1 = route toward tickets, 2 = +stations & ticket drafting. */
  readonly planning: 0 | 1 | 2;
  /** Magnitude of random score jitter — high makes a bot play sloppily. */
  readonly noise: number;
  readonly draftTickets: boolean;
  readonly useStations: boolean;
  /** Reluctance to spend wild locomotives (they are precious for ferries/tunnels). */
  readonly locoPenalty: number;
  /** Factor applied to a not-yet-built ticket's value when deciding whether to keep it. */
  readonly keepFactor: number;
}

const KNOBS: Record<BotDifficulty, Knobs> = {
  EASY: {
    planning: 0,
    noise: 6,
    draftTickets: false,
    useStations: false,
    locoPenalty: 1.5,
    keepFactor: 0,
  },
  MEDIUM: {
    planning: 1,
    noise: 1.5,
    draftTickets: true,
    useStations: false,
    locoPenalty: 2,
    keepFactor: 0.6,
  },
  HARD: {
    planning: 2,
    noise: 0,
    draftTickets: true,
    useStations: true,
    locoPenalty: 2.5,
    keepFactor: 0.7,
  },
};

/** Base bias that makes claiming any affordable route beat a plain card draw → trains drain → game ends. */
const CLAIM_BIAS = 4;

interface Ctx {
  readonly board: Board;
  readonly state: GameState;
  readonly botId: PlayerId;
  readonly knobs: Knobs;
  readonly hand: Readonly<Record<CardColor, number>>;
  readonly trainCars: number;
  readonly keptTickets: readonly TicketId[];
  readonly maxColorCount: number;
  /** routeId → desirability weight (routes lying on a path that completes a kept ticket). */
  readonly wanted: ReadonlyMap<string, number>;
  /** train-card colours the bot wants to draw to afford its wanted routes. */
  readonly needed: ReadonlySet<TrainColor>;
  /** ticket ids the bot holds that are reachable only by spending a station (fully blocked otherwise). */
  readonly blockedTicketCities: ReadonlySet<string>;
}

/** Pick the bot's move for the current state, or null if it has nothing to do right now. */
export function chooseBotAction(
  board: Board,
  state: GameState,
  botId: PlayerId,
  difficulty: BotDifficulty,
): Action | null {
  const legal = legalActions(board, state, botId);
  if (legal.length === 0) return null;
  if (legal.length === 1) return legal[0] ?? null;

  const knobs = KNOBS[difficulty];
  const ctx = buildContext(board, state, botId, knobs);
  const rng = rngFor(state, botId as string);

  let best: Action | null = null;
  let bestScore = -Infinity;
  for (const a of legal) {
    const jitter = knobs.noise > 0 ? (rng() - 0.5) * 2 * knobs.noise : 0;
    const score = scoreAction(a, ctx) + jitter;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

// ── scoring ──────────────────────────────────────────────────────────────────

function scoreAction(a: Action, ctx: Ctx): number {
  switch (a.t) {
    case 'CLAIM_ROUTE':
      return scoreClaim(a, ctx);
    case 'DRAW_FACEUP':
      return scoreFaceup(a, ctx);
    case 'DRAW_BLIND':
      return 3.5;
    case 'DRAW_TICKETS':
      return scoreDrawTickets(ctx);
    case 'BUILD_STATION':
      return scoreStation(a, ctx);
    case 'RESOLVE_TUNNEL':
      return scoreTunnel(a, ctx);
    case 'KEEP_INITIAL_TICKETS':
    case 'KEEP_TICKETS':
      return scoreKeep(a.keep, ctx);
    case 'PASS':
      return -1000; // only ever chosen when it is the sole legal action
  }
}

function scoreClaim(a: Extract<Action, { t: 'CLAIM_ROUTE' }>, ctx: Ctx): number {
  const r = ctx.board.routeById.get(a.routeId as string);
  if (!r) return -1000;
  const pts = ctx.state.ruleParams.routePoints[r.length] ?? r.length;
  let v = pts + CLAIM_BIAS;
  const pull = ctx.wanted.get(a.routeId as string);
  if (pull !== undefined) v += 6 + pull; // strongly prefer routes that complete a ticket
  v -= a.payment.locomotives * ctx.knobs.locoPenalty;
  if (a.payment.color) v -= (ctx.maxColorCount - (ctx.hand[a.payment.color] ?? 0)) * 0.05;
  // Late game: spend remaining trains before the endgame closes the table.
  if (ctx.trainCars <= r.length + 3) v += 1.5;
  return v;
}

function scoreFaceup(a: Extract<Action, { t: 'DRAW_FACEUP' }>, ctx: Ctx): number {
  const card = ctx.state.market[a.slot] ?? null;
  if (card === 'LOCOMOTIVE') return 8; // wild — always valuable
  if (card && ctx.needed.has(card as TrainColor)) return 6; // a colour we are routing toward
  return 3; // a known but not-needed colour
}

function scoreDrawTickets(ctx: Ctx): number {
  if (!ctx.knobs.draftTickets) return -50;
  const target = ctx.knobs.planning === 2 ? 4 : 3;
  const roomToBuild = ctx.trainCars > 20;
  return roomToBuild && ctx.keptTickets.length < target ? 5 : -50;
}

function scoreStation(a: Extract<Action, { t: 'BUILD_STATION' }>, ctx: Ctx): number {
  if (!ctx.knobs.useStations) return -50;
  if (!ctx.blockedTicketCities.has(a.cityId as string)) return -50;
  return 7 - a.payment.locomotives * ctx.knobs.locoPenalty;
}

function scoreTunnel(a: Extract<Action, { t: 'RESOLVE_TUNNEL' }>, ctx: Ctx): number {
  const pt = ctx.state.pendingTunnel;
  if (!a.commit) return -2; // aborting forfeits the laid reveal but never overpays
  if (!pt) return -1000;
  const r = ctx.board.routeById.get(pt.routeId as string);
  const pts = r ? (ctx.state.ruleParams.routePoints[r.length] ?? r.length) : 0;
  const pull = ctx.wanted.get(pt.routeId as string) ?? 0;
  const extra = a.extra ?? { color: null, colorCount: 0, locomotives: 0 };
  return (
    pts + CLAIM_BIAS + pull - extra.locomotives * ctx.knobs.locoPenalty - extra.colorCount * 0.5
  );
}

/** Value of keeping a particular set of tickets (offered at setup or mid-game). */
function scoreKeep(keep: readonly TicketId[], ctx: Ctx): number {
  if (ctx.knobs.planning === 0) return -keep.length; // weak bots keep the minimum, lowest risk
  let total = 0;
  for (const tid of keep) total += keepValue(tid, ctx);
  return total;
}

function keepValue(tid: TicketId, ctx: Ctx): number {
  const t = ctx.board.ticketById.get(tid as string);
  if (!t) return 0;
  if (connectedByOwned(ctx, t.a as string, t.b as string)) return t.value; // already done
  const path = shortestUsablePath(ctx, t.a as string, t.b as string);
  if (!path) return -t.value; // blocked → it will cost us its value at scoring
  return t.value * ctx.knobs.keepFactor - path.cost * 0.6;
}

// ── context / planning ─────────────────────────────────────────────────────────

function buildContext(board: Board, state: GameState, botId: PlayerId, knobs: Knobs): Ctx {
  const self = state.players[botId as string];
  const hand = self?.hand ?? emptyHand();
  const keptTickets = self?.keptTickets ?? [];
  let maxColorCount = 0;
  for (const c of TRAIN_COLORS) maxColorCount = Math.max(maxColorCount, hand[c] ?? 0);

  const wanted = new Map<string, number>();
  const needed = new Set<TrainColor>();
  const blockedTicketCities = new Set<string>();

  if (knobs.planning >= 1) {
    const ctx0: Ctx = {
      board,
      state,
      botId,
      knobs,
      hand,
      trainCars: self?.trainCars ?? 0,
      keptTickets,
      maxColorCount,
      wanted,
      needed,
      blockedTicketCities,
    };
    for (const tid of keptTickets) {
      const t = board.ticketById.get(tid as string);
      if (!t) continue;
      if (connectedByOwned(ctx0, t.a as string, t.b as string)) continue; // already complete
      const path = shortestUsablePath(ctx0, t.a as string, t.b as string);
      if (!path) {
        // Fully blocked — a station on an endpoint may rescue it (hard bots only).
        blockedTicketCities.add(t.a as string);
        blockedTicketCities.add(t.b as string);
        continue;
      }
      const share = t.value / Math.max(1, path.routeIds.length);
      for (const rid of path.routeIds) {
        wanted.set(rid, (wanted.get(rid) ?? 0) + share);
        const r = board.routeById.get(rid);
        if (r && r.color !== 'GRAY') needed.add(r.color as TrainColor);
      }
    }
  }

  return {
    board,
    state,
    botId,
    knobs,
    hand,
    trainCars: self?.trainCars ?? 0,
    keptTickets,
    maxColorCount,
    wanted,
    needed,
    blockedTicketCities,
  };
}

const emptyHand = (): Record<CardColor, number> => {
  const h = {} as Record<CardColor, number>;
  for (const c of TRAIN_COLORS) h[c] = 0;
  h.LOCOMOTIVE = 0;
  return h;
};

/** Is a route currently usable for the bot to traverse/claim? */
function routeUsable(ctx: Ctx, routeId: string): 'owned' | 'open' | null {
  const cell = ctx.state.ownership[routeId];
  if (!cell) return 'open';
  if ('owner' in cell) return cell.owner === ctx.botId ? 'owned' : null;
  return null; // locked double-route sibling
}

/** Are two cities connected purely through routes the bot already owns? (ticket completion) */
function connectedByOwned(ctx: Ctx, a: string, b: string): boolean {
  if (a === b) return true;
  const seen = new Set<string>([a]);
  const stack = [a];
  while (stack.length > 0) {
    const city = stack.pop() as string;
    for (const rid of ctx.board.incident.get(city) ?? []) {
      if (routeUsable(ctx, rid as string) !== 'owned') continue;
      const r = ctx.board.routeById.get(rid as string);
      if (!r) continue;
      const next = (r.a as string) === city ? (r.b as string) : (r.a as string);
      if (next === b) return true;
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return false;
}

/**
 * Cheapest route-length path between two cities over edges the bot could still use
 * (open routes, or ones it already owns at zero cost). Returns the not-yet-owned route
 * ids on that path (the ones it still needs to claim) and the total claim cost.
 */
function shortestUsablePath(
  ctx: Ctx,
  from: string,
  to: string,
): { cost: number; routeIds: string[] } | null {
  if (from === to) return { cost: 0, routeIds: [] };
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, { city: string; routeId: string; owned: boolean }>();
  const visited = new Set<string>();

  for (;;) {
    let city: string | null = null;
    let best = Infinity;
    for (const [c, d] of dist) {
      if (!visited.has(c) && d < best) {
        best = d;
        city = c;
      }
    }
    if (city === null) break;
    if (city === to) break;
    visited.add(city);

    for (const rid of ctx.board.incident.get(city) ?? []) {
      const usable = routeUsable(ctx, rid as string);
      if (usable === null) continue;
      const r = ctx.board.routeById.get(rid as string);
      if (!r) continue;
      const next = (r.a as string) === city ? (r.b as string) : (r.a as string);
      const step = usable === 'owned' ? 0 : r.length;
      const nd = best + step;
      if (nd < (dist.get(next) ?? Infinity)) {
        dist.set(next, nd);
        prev.set(next, { city, routeId: rid as string, owned: usable === 'owned' });
      }
    }
  }

  if (!dist.has(to)) return null;
  const routeIds: string[] = [];
  let cur = to;
  while (cur !== from) {
    const p = prev.get(cur);
    if (!p) return null;
    if (!p.owned) routeIds.push(p.routeId);
    cur = p.city;
  }
  return { cost: dist.get(to) ?? 0, routeIds };
}

// ── deterministic RNG (per state+bot) ────────────────────────────────────────

/** mulberry32 seeded from (actionSeq, botId): same situation → same choice, for reproducibility. */
function rngFor(state: GameState, botId: string): () => number {
  let h = 2166136261 >>> 0;
  const key = `${state.actionSeq}:${botId}`;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
