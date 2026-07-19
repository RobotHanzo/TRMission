// The bot brain. `chooseBotAction` ranks every *legal* action (candidates come straight
// from the engine's `legalActions`, so a bot can never emit an illegal move) by a
// difficulty-tuned utility and returns the best one. Four difficulties differ in:
//   • planning  — 1: route toward tickets; 2: +stations & ticket drafting; 3: joint
//     multi-ticket planning (paths share a trunk) + proactive stations + bottleneck
//     grabs; 4 (HELL): +tunnel risk priced off unseen-pool card counting, colour-reserve
//     payment discipline, point-density claim tilt, longest-trail contention, and endgame
//     tempo keyed to the authoritative countdown,
//   • noise      — random jitter that makes the entry tier play loosely,
//   • eventSense — whether event actions are scored in context (HARD+) or by flat priors.
//
// Decisions use only fair information (the bot's own hand/tickets + public board state),
// the same a human client could compute — the hidden event schedule, the deck order, and
// opponents' hand colours / ticket ids are never read. HELL's card counting works off the
// PUBLIC discard/market counts; its opponent awareness reads only claimed routes (public
// ownership) and the public endgame countdown.
// Picks are a deterministic function of state + botId, so behaviour is reproducible
// (handy for tests); the chosen action is logged like any other, so replay/recovery
// never depends on the policy.
import {
  legalActions,
  closedRouteIds,
  skyLanternDoubles,
  hotspotLevel,
  stampRallyActive,
  playerNetworkCities,
  routeTouchesCity,
  routeTouchesRegion,
  activeHarvestRegion,
  processionCurrentCity,
  groupMembersOf,
  effectiveTunnelRevealCount,
  longestTrail,
  longestTrailWithPath,
} from '@trm/engine';
import type { Action, Board, GameState, TrailEdge } from '@trm/engine';
import { TRAIN_COLORS, CARD_COLORS, buildDeckComposition } from '@trm/shared';
import type { PlayerId, CardColor, TrainColor, TicketId, RouteId, CityId } from '@trm/shared';
import type { BotDifficulty } from './types';

interface Knobs {
  /** 1 = route toward tickets, 2 = +stations & ticket drafting,
   *  3 = joint multi-ticket planning + proactive stations + opponent awareness,
   *  4 = +tunnel risk pricing, colour reserve, point-density tilt, longest-trail
   *  contention, endgame tempo. */
  readonly planning: 1 | 2 | 3 | 4;
  /** Magnitude of random score jitter — high makes a bot play sloppily. */
  readonly noise: number;
  readonly draftTickets: boolean;
  readonly useStations: boolean;
  /** Reluctance to spend wild locomotives (they are precious for ferries/tunnels). */
  readonly locoPenalty: number;
  /** Factor applied to a not-yet-built ticket's value when deciding whether to keep it. */
  readonly keepFactor: number;
  /** Score event actions by their actual in-context value instead of flat priors. */
  readonly eventSense: boolean;
}

const KNOBS: Record<BotDifficulty, Knobs> = {
  EASY: {
    planning: 1,
    noise: 1.5,
    draftTickets: true,
    useStations: false,
    locoPenalty: 2,
    keepFactor: 0.6,
    eventSense: false,
  },
  MEDIUM: {
    planning: 2,
    noise: 0,
    draftTickets: true,
    useStations: true,
    locoPenalty: 2.5,
    keepFactor: 0.7,
    eventSense: false,
  },
  HARD: {
    planning: 3,
    noise: 0,
    draftTickets: true,
    useStations: true,
    locoPenalty: 2.5,
    keepFactor: 0.7,
    eventSense: true,
  },
  HELL: {
    planning: 4,
    noise: 0,
    draftTickets: true,
    useStations: true,
    locoPenalty: 2.5,
    keepFactor: 0.7,
    eventSense: true,
  },
};

// HELL scoring weights, tuned with test/strength.harness.spec.ts against the HARD policy
// (60W-38L-2T, +11.1 mean margin over 100 seeded 2p matches at these values). Ablations that
// LOST to HARD and were dropped: opponent-corridor denial maps, ticket-race draft suppression,
// unseen-pool blind/face-up draw EV, and a contested-bottleneck claim bonus.
/** Expected-overpay weight per (reveal × match-probability) unit on tunnel claims. */
const TUNNEL_RISK = 0.6;
/** Penalty per card of an off-plan payment that dips below a wanted colour's reserve. */
const RESERVE_W = 0.8;
/** Point-density tilt weight (scaled by game-phase urgency). */
const PPT_W = 3;
/** Early-game damping on off-plan length<=2 claims. */
const SHORT_DAMP = 1.5;
/** Trail-endpoint claim bonus before the countdown starts (2 once it runs). */
const TRAIL_EARLY_W = 0.8;

/** Base bias that makes claiming any affordable route beat a plain card draw → trains drain → game ends. */
const CLAIM_BIAS = 4;

/** Any player this low on trains can trigger the endgame — time to spend, not hoard. */
const ENDGAME_TRAINS = 8;

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
  /** cityId → rescued value of a station there (HELL: a borrow is the only way to finish). */
  readonly stationWanted: ReadonlyMap<string, number>;
  /** Routes temporarily closed by an active typhoon/slope-repair (public info). */
  readonly closedRoutes: ReadonlySet<string>;
  /** Someone (anyone) is close to draining their trains — the table is about to close. */
  readonly endgameNear: boolean;
  /** Kept tickets not yet connected by the bot's own track. */
  readonly incompleteTickets: number;
  // ── HELL-only context (planning >= 4); zero/empty for lower tiers ──
  /** Per-colour count of cards NOT visible to the bot (deck + opponents' hands, estimated
   *  as full composition − own hand − market − discard − pending tunnel reveal). */
  readonly unseen: Readonly<Record<CardColor, number>>;
  readonly unseenTotal: number;
  /** The authoritative endgame countdown has started (public `state.endgame`). */
  readonly lastRound: boolean;
  /** Own full turns left once the countdown runs (Infinity before it triggers). */
  readonly myTurnsLeft: number;
  /** Walk endpoints of the bot's own current longest trail, when the bonus is contested. */
  readonly trailEndpoints: ReadonlySet<string>;
  /** colour → largest single unclaimed wanted-route cost in that colour (reserve target). */
  readonly neededAmount: ReadonlyMap<TrainColor, number>;
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
    case 'END_GAME':
      return -Infinity; // internal control-plane action; legalActions never returns it
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
    case 'RELOCATE_LANTERN_HOST':
      return scoreLanternRelocation(a, ctx);
    case 'REPAIR_ROUTE':
      return scoreRepair(a, ctx);
    case 'NIGHT_MARKET_SWAP':
      return scoreNightMarketSwap(a, ctx);
    case 'CHOOSE_EVENT_PERK':
      return scoreEventPerk(a, ctx);
    case 'START_HIVE_DRAW':
      return ctx.knobs.eventSense ? 6.5 : 5;
    case 'CONTINUE_HIVE_DRAW':
      // Bust only forfeits the cards revealed *after* the first, and only on a colour pair
      // (~1-in-8 with a near-uniform pool) — with maxDraws 4 continuing is always +EV.
      if (ctx.knobs.eventSense) return 7;
      return (ctx.state.events?.pendingHiveDraw?.revealed.length ?? 0) < 3 ? 6 : 1;
    case 'STOP_HIVE_DRAW':
      if (ctx.knobs.eventSense) return 1;
      return (ctx.state.events?.pendingHiveDraw?.revealed.length ?? 0) >= 3 ? 7 : 2;
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
  if (ctx.knobs.planning >= 3) {
    // A wanted route with no open alternative is a bottleneck — grab it before an opponent does.
    if (pull !== undefined && !hasOpenAlternative(ctx, a.routeId as string)) v += 2;
    // Discipline: while a live ticket plan exists and trains are plentiful, off-plan claims
    // burn the trains the plan needs. Once trains run low the brake releases so the endgame
    // still drains them (termination stays safe). HELL also releases it the moment the
    // authoritative countdown starts — no plan pays off beyond what is banked by then.
    if (
      pull === undefined &&
      ctx.incompleteTickets > 0 &&
      ctx.wanted.size > 0 &&
      ctx.trainCars > 10 &&
      !ctx.lastRound
    )
      v -= 6;
  }
  if (ctx.knobs.eventSense) {
    v += eventClaimBonus(a.routeId as string, r, pts, ctx);
    v += paymentShaping(a.payment, r.length);
  }
  if (ctx.knobs.planning >= 4) {
    // Tunnel risk: expected surcharge = reveal count × P(a revealed card matches the payment),
    // over the unseen pool. Also steers WHICH payment variant to use (scarce colour matches less).
    if (r.isTunnel) {
      const pMatch =
        ((a.payment.color ? (ctx.unseen[a.payment.color] ?? 0) : 0) +
          (ctx.unseen.LOCOMOTIVE ?? 0)) /
        ctx.unseenTotal;
      v -= effectiveTunnelRevealCount(ctx.state) * pMatch * TUNNEL_RISK;
    }
    // Colour reserve: don't fund an off-plan claim with a colour a wanted route still needs.
    if (a.payment.color && pull === undefined) {
      const reserve = ctx.neededAmount.get(a.payment.color as TrainColor);
      if (reserve !== undefined) {
        const after = (ctx.hand[a.payment.color] ?? 0) - a.payment.colorCount;
        if (after < reserve) v -= Math.min(a.payment.colorCount, reserve - after) * RESERVE_W;
      }
    }
    // Point density: the route score table is convex (a len-6 banks 2.5 pts/train vs 1 for a
    // len-2), so tilt every claim toward long, point-dense routes — the tilt strengthens as
    // the table closes, and on our own final turn nothing but banked points matters.
    const urgency = ctx.lastRound ? 1 : ctx.endgameNear ? 0.5 : 0.25;
    v += (pts / Math.max(1, r.length) - 1) * urgency * PPT_W;
    if (ctx.myTurnsLeft <= 1) v += pts * 0.5;
    // Early short-route claims waste tempo a long dump would spend better (convex scoring).
    if (SHORT_DAMP > 0 && r.length <= 2 && pull === undefined && !ctx.endgameNear && !ctx.lastRound)
      v -= SHORT_DAMP;
    // Longest-trail contention: extend our own best trail from its endpoints while the bonus
    // is still in reach of a rival.
    if (ctx.trailEndpoints.has(r.a as string) || ctx.trailEndpoints.has(r.b as string))
      v += ctx.lastRound ? 2 : TRAIL_EARLY_W;
  }
  return v;
}

/** Extra points this claim earns (or sets up) under the currently-active public events. */
function eventClaimBonus(
  routeId: string,
  r: { readonly a: CityId; readonly b: CityId; readonly length: number },
  pts: number,
  ctx: Ctx,
): number {
  const { board, state, botId } = ctx;
  let v = 0;
  const rid = routeId as RouteId;
  if (skyLanternDoubles(state, rid)) v += pts; // points are doubled while the lanterns fly
  if (state.events?.reopenBonus.includes(rid)) v += 2; // first claim of a reopened route
  v += hotspotLevel(state, r.a);
  v += hotspotLevel(state, r.b);
  const host = state.events?.lanternHost;
  if (host && routeTouchesCity(board, rid, host.cityId)) v += host.points;
  if (stampRallyActive(state)) {
    const mine = playerNetworkCities(board, state, botId);
    if (!mine.has(r.a as string)) v += 1;
    if (!mine.has(r.b as string)) v += 1;
  }
  const harvest = activeHarvestRegion(state);
  if (harvest !== null && routeTouchesRegion(board, rid, harvest)) v += 1;
  const procession = processionCurrentCity(state);
  if (procession !== null && routeTouchesCity(board, rid, procession)) v += 2;
  return v;
}

/**
 * Prefer cheaper payment variants for the same route (bento wilds / claim discounts drop a
 * card), but hold the one-shot claim-discount perk back for long routes where it matters.
 * Scored relative to the route's base cost so it never biases the choice BETWEEN routes.
 */
function paymentShaping(
  payment: Extract<Action, { t: 'CLAIM_ROUTE' }>['payment'],
  routeLength: number,
): number {
  let v = -(payment.colorCount + payment.locomotives - routeLength) * 0.3;
  if (payment.bentoSpend === 'POINTS') v += 1.5; // +2 points minus the token's wild value
  if (payment.useClaimDiscount) v += routeLength >= 4 ? 1 : -0.5;
  return v;
}

/** Is any parallel/sibling of this route still openly claimable? (if not, it is a bottleneck) */
function hasOpenAlternative(ctx: Ctx, routeId: string): boolean {
  for (const rid of groupMembersOf(ctx.board, routeId as RouteId)) {
    if ((rid as string) === routeId) continue;
    if (!ctx.state.ownership[rid as string] && !ctx.closedRoutes.has(rid as string)) return true;
  }
  return false;
}

function scoreFaceup(a: Extract<Action, { t: 'DRAW_FACEUP' }>, ctx: Ctx): number {
  const card = ctx.state.market[a.slot] ?? null;
  if (card === 'LOCOMOTIVE') return 8; // wild — always valuable
  if (card && ctx.needed.has(card as TrainColor)) return 6; // a colour we are routing toward
  return 3; // a known but not-needed colour
}

function scoreDrawTickets(ctx: Ctx): number {
  if (!ctx.knobs.draftTickets) return -50;
  // HELL: never draft into the confirmed countdown — there is no runway left to build.
  if (ctx.lastRound) return -50;
  if (ctx.knobs.planning >= 3) {
    // Draft eagerly once every kept ticket is built (a mature network completes fresh
    // tickets cheaply), otherwise at HARD's cautious pace; never near the endgame.
    if (ctx.endgameNear) return -50;
    if (ctx.incompleteTickets === 0 && ctx.trainCars > 12) return 6;
    return ctx.trainCars > 20 && ctx.keptTickets.length < 4 ? 5 : -50;
  }
  const target = ctx.knobs.planning === 2 ? 4 : 3;
  const roomToBuild = ctx.trainCars > 20;
  return roomToBuild && ctx.keptTickets.length < target ? 5 : -50;
}

function scoreStation(a: Extract<Action, { t: 'BUILD_STATION' }>, ctx: Ctx): number {
  if (!ctx.knobs.useStations) return -50;
  const cost =
    a.payment.locomotives * ctx.knobs.locoPenalty +
    (ctx.knobs.planning >= 3 ? a.payment.colorCount * 0.3 : 0);
  const planned = ctx.stationWanted.get(a.cityId as string);
  if (ctx.knobs.planning >= 3 && planned !== undefined) {
    // The planner decided a borrow here is the only way to finish a goal; `planned` carries
    // the rescued value. Build LATE — a station never expires, so spending the tempo (and
    // cards) mid-game only helps opponents race us to open routes.
    if (!ctx.endgameNear && ctx.trainCars > 15) return -50;
    return 6 + Math.min(6, planned * 0.3) - cost;
  }
  if (!ctx.blockedTicketCities.has(a.cityId as string)) return -50;
  return 7 - cost;
}

function scoreTunnel(a: Extract<Action, { t: 'RESOLVE_TUNNEL' }>, ctx: Ctx): number {
  const pt = ctx.state.pendingTunnel;
  if (!a.commit) return -2; // aborting forfeits the laid reveal but never overpays
  if (!pt) return -1000;
  const r = ctx.board.routeById.get(pt.routeId as string);
  const pts = r ? (ctx.state.ruleParams.routePoints[r.length] ?? r.length) : 0;
  const doubled = ctx.knobs.eventSense && skyLanternDoubles(ctx.state, pt.routeId) ? pts : 0;
  const pull = ctx.wanted.get(pt.routeId as string) ?? 0;
  const extra = a.extra ?? { color: null, colorCount: 0, locomotives: 0 };
  return (
    pts +
    doubled +
    CLAIM_BIAS +
    pull -
    extra.locomotives * ctx.knobs.locoPenalty -
    extra.colorCount * 0.5
  );
}

/** Value of keeping a particular set of tickets (offered at setup or mid-game). */
function scoreKeep(keep: readonly TicketId[], ctx: Ctx): number {
  if (ctx.knobs.planning >= 3) return scoreKeepSet(keep, ctx);
  let total = 0;
  for (const tid of keep) total += keepValue(tid, ctx);
  return total;
}

/**
 * HELL evaluates the keep-SET as one plan, not ticket-by-ticket: routes shared between the
 * tickets' paths are priced ONCE (real overlap synergy), and a set whose combined claim cost
 * exceeds the trains left simply cannot be finished — penalise it instead of discovering that
 * at final scoring.
 */
function scoreKeepSet(keep: readonly TicketId[], ctx: Ctx): number {
  const unionRoutes = new Map<string, number>(); // routeId → claim length
  let total = 0;
  for (const tid of keep) {
    const t = ctx.board.ticketById.get(tid as string);
    if (!t) continue;
    if (connectedByOwned(ctx, t.a as string, t.b as string)) {
      total += t.value; // already done
      continue;
    }
    const path = planPath(ctx, t.a as string, t.b as string);
    if (!path) {
      total -= t.value; // blocked → it will cost us its value at scoring
      continue;
    }
    total += t.value * ctx.knobs.keepFactor;
    for (const rid of path.routeIds) {
      unionRoutes.set(rid, ctx.board.routeById.get(rid)?.length ?? 0);
    }
  }
  let cost = 0;
  for (const len of unionRoutes.values()) cost += len;
  total -= cost * 0.6;
  if (cost > ctx.trainCars) total -= (cost - ctx.trainCars) * 1.5; // unbuildable overhang
  return total;
}

function keepValue(tid: TicketId, ctx: Ctx): number {
  const t = ctx.board.ticketById.get(tid as string);
  if (!t) return 0;
  if (connectedByOwned(ctx, t.a as string, t.b as string)) return t.value; // already done
  const path = planPath(ctx, t.a as string, t.b as string);
  if (!path) return -t.value; // blocked → it will cost us its value at scoring
  return t.value * ctx.knobs.keepFactor - path.cost * 0.6;
}

// ── event-action scoring ─────────────────────────────────────────────────────

/** The relocation is mandatory; HELL steers the host toward its own remaining plans. */
function scoreLanternRelocation(
  a: Extract<Action, { t: 'RELOCATE_LANTERN_HOST' }>,
  ctx: Ctx,
): number {
  if (!ctx.knobs.eventSense) return 100;
  // Prefer a host city where we still intend to claim — we would collect its points again.
  let openWanted = 0;
  for (const rid of ctx.board.incident.get(a.cityId as string) ?? []) {
    if (ctx.wanted.has(rid as string) && !ctx.state.ownership[rid as string]) openWanted++;
  }
  return 100 + Math.min(2, openWanted) * 3;
}

function scoreRepair(a: Extract<Action, { t: 'REPAIR_ROUTE' }>, ctx: Ctx): number {
  const cost = a.payment.locomotives * ctx.knobs.locoPenalty;
  const r = ctx.board.routeById.get(a.routeId as string);
  const carriages = r?.brokenCarriages ?? 0;
  if (r && carriages > 0 && !ctx.state.brokenRails?.[a.routeId as string]) {
    // Broken-rail (斷軌) repair: banks routePoints[carriages] immediately (no trains spent) and
    // grants one round of exclusive claim rights — extra-valuable when we want the route.
    const pts = ctx.state.ruleParams.routePoints[carriages] ?? carriages;
    let v = pts + 1 - cost;
    const pull = ctx.wanted.get(a.routeId as string);
    if (pull !== undefined) v += 4 + pull;
    return v;
  }
  if (!ctx.knobs.eventSense) return 7 - cost;
  // Repairing spends the whole turn and reopens the route for everyone — only worth it
  // for a route we plan to claim ourselves (the +2 reopen bonus goes to the first claimer).
  const pull = ctx.wanted.get(a.routeId as string);
  return pull !== undefined ? 7 + pull - cost : 1 - cost;
}

/** The swap is FREE (does not end the turn), so any net-positive trade should happen first. */
function scoreNightMarketSwap(a: Extract<Action, { t: 'NIGHT_MARKET_SWAP' }>, ctx: Ctx): number {
  if (!ctx.knobs.eventSense) return 4;
  const took = ctx.state.market[a.slot] ?? null;
  const gain = took === 'LOCOMOTIVE' ? 3.5 : took && ctx.needed.has(took as TrainColor) ? 2.5 : 0.5;
  const loss =
    a.giveColor === 'LOCOMOTIVE' ? 5 : ctx.needed.has(a.giveColor as TrainColor) ? 2 : 0.2;
  const net = gain - loss;
  return net > 0 ? 12 + net : -10;
}

function scoreEventPerk(a: Extract<Action, { t: 'CHOOSE_EVENT_PERK' }>, ctx: Ctx): number {
  if (!ctx.knobs.eventSense) {
    return a.perk === 'DRAW_TWO' ? 9 : a.perk === 'CLAIM_DISCOUNT' ? 8 : 6;
  }
  switch (a.perk) {
    case 'REPAIR_PERMIT': {
      // A free repair is gold when a route we are routing toward is currently closed.
      for (const rid of ctx.closedRoutes) if (ctx.wanted.has(rid)) return 10;
      return 5;
    }
    case 'CLAIM_DISCOUNT': {
      // Worth holding when an expensive wanted claim is still open.
      for (const [rid] of ctx.wanted) {
        const r = ctx.board.routeById.get(rid);
        if (r && r.length >= 4 && !ctx.state.ownership[rid]) return 9.5;
      }
      return 7.5;
    }
    case 'DRAW_TWO':
      return 9;
  }
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
  const stationWanted = new Map<string, number>();
  const closedRoutes: ReadonlySet<string> = knobs.eventSense ? closedRouteIds(state) : EMPTY_SET;

  let endgameNear = false;
  if (knobs.planning >= 3) {
    for (const pid of state.turnOrder) {
      if ((state.players[pid as string]?.trainCars ?? Infinity) <= ENDGAME_TRAINS)
        endgameNear = true;
    }
  }

  const hell = knobs.planning >= 4;
  const pool = hell ? unseenPool(state, hand) : null;
  const neededAmount = new Map<TrainColor, number>();
  const lastRound = hell && state.endgame.triggered;
  const myTurnsLeft = lastRound
    ? Math.ceil(state.endgame.finalTurnsRemaining / Math.max(1, state.turnOrder.length))
    : Infinity;

  let incompleteTickets = 0;

  const ctx: Ctx = {
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
    stationWanted,
    closedRoutes,
    endgameNear,
    get incompleteTickets() {
      return incompleteTickets;
    },
    unseen: pool?.unseen ?? emptyHand(),
    unseenTotal: pool?.total ?? 1,
    lastRound,
    myTurnsLeft,
    trailEndpoints: hell ? contestedTrailEndpoints(board, state, botId) : EMPTY_SET,
    neededAmount,
  };

  if (knobs.planning >= 1) {
    for (const goal of planningGoals(ctx)) {
      if (connectedByOwned(ctx, goal.a, goal.b)) continue; // already complete
      if (goal.ticket) incompleteTickets++;
      const path = planPath(ctx, goal.a, goal.b);
      if (!path) {
        // Fully blocked — a station on an endpoint may rescue it (hard bots only).
        blockedTicketCities.add(goal.a);
        blockedTicketCities.add(goal.b);
        continue;
      }
      if (path.borrowCity !== null) {
        // Borrowing one opponent edge via a station there is the only way to finish this goal.
        stationWanted.set(path.borrowCity, (stationWanted.get(path.borrowCity) ?? 0) + goal.value);
      }
      const share = goal.value / Math.max(1, path.routeIds.length);
      for (const rid of path.routeIds) {
        wanted.set(rid, (wanted.get(rid) ?? 0) + share);
        const r = board.routeById.get(rid);
        if (r && r.color !== 'GRAY') {
          needed.add(r.color as TrainColor);
          if (hell) {
            const c = r.color as TrainColor;
            neededAmount.set(c, Math.max(neededAmount.get(c) ?? 0, r.length));
          }
        }
      }
    }
  }

  return ctx;
}

/**
 * Route a goal on the bot's usable board. HELL first plans borrow-free; only when the goal is
 * otherwise unreachable does it retry allowing ONE station borrow (the rescue HARD approximates
 * by flagging endpoints). Lower tiers keep the plain search.
 */
function planPath(
  ctx: Ctx,
  from: string,
  to: string,
): { cost: number; routeIds: string[]; borrowCity: string | null } | null {
  const opts = pathOptsFor(ctx);
  const path = shortestUsablePath(ctx, from, to, opts);
  if (path || ctx.knobs.planning < 3) return path;
  const self = ctx.state.players[ctx.botId as string];
  const canStation =
    (self?.stationsRemaining ?? 0) > 0 || ctx.state.stations.some((s) => s.playerId === ctx.botId);
  if (!canStation) return null;
  return shortestUsablePath(ctx, from, to, { ...opts, maxBorrows: 1 });
}

interface PlanningGoal {
  readonly a: string;
  readonly b: string;
  readonly value: number;
  /** True for a kept ticket (scores negatively if unfinished), false for an event side goal. */
  readonly ticket: boolean;
}

/**
 * What the bot is building toward. Kept tickets always; HELL orders them by value (so the
 * trunk-sharing discount converges the cheap tickets onto the valuable ones' corridors) and
 * also chases unwon charter/lucky contracts — public event goals anyone may claim.
 */
function planningGoals(ctx: Ctx): PlanningGoal[] {
  const goals: PlanningGoal[] = [];
  for (const tid of ctx.keptTickets) {
    const t = ctx.board.ticketById.get(tid as string);
    if (t) goals.push({ a: t.a as string, b: t.b as string, value: t.value, ticket: true });
  }
  if (ctx.knobs.planning >= 3) {
    goals.sort((x, y) => y.value - x.value || (x.a < y.a ? -1 : 1));
    if (ctx.knobs.eventSense) {
      // Side goals, deliberately underweighted: contracts are a race anyone can win, so
      // they bend the trunk toward bonus points but never outrank a kept ticket.
      for (const c of ctx.state.events?.charters ?? []) {
        if (c.wonBy === null)
          goals.push({ a: c.a as string, b: c.b as string, value: c.points * 0.5, ticket: false });
      }
      for (const c of ctx.state.events?.luckyContracts ?? []) {
        if (c.wonBy === null)
          goals.push({ a: c.a as string, b: c.b as string, value: c.points * 0.5, ticket: false });
      }
    }
  }
  return goals;
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

const emptyHand = (): Record<CardColor, number> => {
  const h = {} as Record<CardColor, number>;
  for (const c of TRAIN_COLORS) h[c] = 0;
  h.LOCOMOTIVE = 0;
  return h;
};

// ── HELL-only context builders (planning >= 4) ───────────────────────────────

/**
 * Per-colour census of the cards the bot cannot see (deck + opponents' hands), from PUBLIC
 * counts only: full composition − own hand − face-up market − discard − pending tunnel reveal.
 * The exchangeability posterior unseen[c]/total is then the fair estimate of "next blind card
 * is colour c" — exactly the count a card-counting human could keep.
 */
function unseenPool(
  state: GameState,
  hand: Readonly<Record<CardColor, number>>,
): { unseen: Record<CardColor, number>; total: number } {
  const unseen = buildDeckComposition(state.ruleParams);
  for (const c of CARD_COLORS)
    unseen[c] = Math.max(0, unseen[c] - (hand[c] ?? 0) - (state.discard[c] ?? 0));
  for (const m of state.market) if (m) unseen[m] = Math.max(0, unseen[m] - 1);
  for (const c of state.pendingTunnel?.revealed ?? []) unseen[c] = Math.max(0, unseen[c] - 1);
  let total = 0;
  for (const c of CARD_COLORS) total += unseen[c];
  return { unseen, total: Math.max(1, total) };
}

/** Owned routes of `pid` as weighted trail edges (ownership is public). */
function trailEdgesOf(board: Board, state: GameState, pid: PlayerId): TrailEdge[] {
  const edges: TrailEdge[] = [];
  for (const [routeId, cell] of Object.entries(state.ownership)) {
    if ('owner' in cell && cell.owner === pid) {
      const r = board.routeById.get(routeId);
      if (r) edges.push({ u: r.a as string, v: r.b as string, w: r.length });
    }
  }
  return edges;
}

/** Small deterministic budget: mid-game networks are tiny next to final-scoring's default. */
const TRAIL_BUDGET = 20_000;

/**
 * Walk endpoints (odd-degree vertices) of the bot's own current longest trail — but only while
 * the longest-trail bonus is contested (a rival's trail is within striking distance, mirroring
 * how final scoring awards ties to everyone at the max). Empty set ⇒ don't chase the bonus.
 */
function contestedTrailEndpoints(
  board: Board,
  state: GameState,
  botId: PlayerId,
): ReadonlySet<string> {
  const mine = trailEdgesOf(board, state, botId);
  if (mine.length === 0) return EMPTY_SET;
  let bestRival = 0;
  for (const pid of state.turnOrder) {
    if (pid === botId) continue;
    const rival = longestTrail(trailEdgesOf(board, state, pid), TRAIL_BUDGET);
    bestRival = Math.max(bestRival, rival);
  }
  const my = longestTrailWithPath(mine, TRAIL_BUDGET);
  if (my.length < bestRival - 4) return EMPTY_SET; // out of reach — points elsewhere are better
  const degree = new Map<string, number>();
  for (const i of my.edges) {
    const e = mine[i];
    if (!e) continue;
    degree.set(e.u, (degree.get(e.u) ?? 0) + 1);
    degree.set(e.v, (degree.get(e.v) ?? 0) + 1);
  }
  const endpoints = new Set<string>();
  for (const [city, d] of degree) if (d % 2 === 1) endpoints.add(city);
  if (endpoints.size === 0) {
    // A closed trail (Euler circuit over the owned loop) has no odd-degree vertex, but it can
    // be broken open and extended from ANY of its cities — every visited city is an endpoint.
    for (const city of degree.keys()) endpoints.add(city);
  }
  return endpoints;
}

/** Is a route currently usable for the bot to traverse/claim? */
function routeUsable(ctx: Ctx, routeId: string): 'owned' | 'open' | 'enemy' | null {
  const cell = ctx.state.ownership[routeId];
  if (!cell) return 'open';
  if ('owner' in cell) return cell.owner === ctx.botId ? 'owned' : 'enemy';
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

interface PathOpts {
  /** Typhoon-closed routes cost extra (they reopen later or need a repair turn). */
  readonly avoidClosed?: ReadonlySet<string>;
  /** Allow crossing up to this many opponent edges, each via a station at its near city. */
  readonly maxBorrows?: number;
}

/**
 * Planning options for the goal plan. Deliberately structural only (route lengths — never the
 * current hand): the plan must be stable from turn to turn, and owned routes costing zero is
 * what anchors it to work already done. Bending it toward today's cards makes it oscillate and
 * abandon half-claimed corridors.
 */
function pathOptsFor(ctx: Ctx): PathOpts | undefined {
  if (ctx.knobs.planning < 3) return undefined;
  return { avoidClosed: ctx.closedRoutes, maxBorrows: 0 };
}

/**
 * Cheapest route-length path between two cities over edges the bot could still use
 * (open routes, or ones it already owns at zero cost). Returns the not-yet-owned route
 * ids on that path (the ones it still needs to claim) and the total claim cost.
 *
 * With `opts` (HELL) the search additionally discounts trunk/affordable routes, penalises
 * typhoon-closed ones, and may cross ONE opponent-owned edge by pricing in a station at the
 * city it is entered from (`borrowCity` in the result) — the same borrow the scorer honours.
 */
function shortestUsablePath(
  ctx: Ctx,
  from: string,
  to: string,
  opts?: PathOpts,
): { cost: number; routeIds: string[]; borrowCity: string | null } | null {
  if (from === to) return { cost: 0, routeIds: [], borrowCity: null };
  const maxBorrows = opts?.maxBorrows ?? 0;
  const ownStations = new Set(
    ctx.state.stations.filter((s) => s.playerId === ctx.botId).map((s) => s.cityId as string),
  );
  const built =
    ctx.state.ruleParams.stationsPerPlayer -
    (ctx.state.players[ctx.botId as string]?.stationsRemaining ??
      ctx.state.ruleParams.stationsPerPlayer);

  // Dijkstra over (city, borrowsUsed) layers; the board is small so O(V²) selection is fine.
  const key = (city: string, borrows: number) => `${city}|${borrows}`;
  const dist = new Map<string, number>([[key(from, 0), 0]]);
  const prev = new Map<
    string,
    { key: string; city: string; routeId: string; owned: boolean; borrowCity: string | null }
  >();
  const visited = new Set<string>();

  for (;;) {
    let curKey: string | null = null;
    let best = Infinity;
    for (const [k, d] of dist) {
      if (!visited.has(k) && d < best) {
        best = d;
        curKey = k;
      }
    }
    if (curKey === null) break;
    visited.add(curKey);
    const sep = curKey.lastIndexOf('|');
    const city = curKey.slice(0, sep);
    const borrows = Number(curKey.slice(sep + 1));
    if (city === to) break;

    for (const rid of ctx.board.incident.get(city) ?? []) {
      const usable = routeUsable(ctx, rid as string);
      if (usable === null) continue;
      const r = ctx.board.routeById.get(rid as string);
      if (!r) continue;
      const next = (r.a as string) === city ? (r.b as string) : (r.a as string);

      let step: number;
      let nextBorrows = borrows;
      let borrowCity: string | null = null;
      if (usable === 'owned') {
        step = 0;
      } else if (usable === 'open') {
        step = r.length;
        if (opts?.avoidClosed?.has(rid as string)) step += 2;
      } else {
        // enemy-owned: cross it by borrowing via a station at the entry city.
        if (borrows >= maxBorrows) continue;
        nextBorrows = borrows + 1;
        borrowCity = city;
        // An existing own station is nearly free; a new one costs cards + the unused-station
        // bonus it forfeits (approximated in route-length units).
        step = ownStations.has(city) ? 0.5 : 3 + built;
      }

      const nk = key(next, nextBorrows);
      const nd = best + step;
      if (nd < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nd);
        prev.set(nk, {
          key: curKey,
          city,
          routeId: rid as string,
          owned: usable === 'owned',
          borrowCity,
        });
      }
    }
  }

  // Cheapest arrival at the target across borrow layers.
  let endKey: string | null = null;
  let endCost = Infinity;
  for (let b = 0; b <= maxBorrows; b++) {
    const d = dist.get(key(to, b));
    if (d !== undefined && d < endCost) {
      endCost = d;
      endKey = key(to, b);
    }
  }
  if (endKey === null) return null;

  const routeIds: string[] = [];
  let borrowCity: string | null = null;
  let cur = endKey;
  while (cur !== key(from, 0)) {
    const p = prev.get(cur);
    if (!p) return null;
    if (p.borrowCity !== null) borrowCity = p.borrowCity;
    else if (!p.owned) routeIds.push(p.routeId);
    cur = p.key;
  }
  return { cost: endCost, routeIds, borrowCity };
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
