import type { RngState, SeatIndex, RouteId } from '@trm/shared';
import { asPlayerId, makeRng, nextInt } from '@trm/shared';
import { taiwanBoard, CONTENT_HASH } from '../src/taiwan';
import type { Board } from '../src/board';
import type { GameConfig } from '../src/config';
import type { GameState } from '../src/types/state';
import type { Action, Payment } from '../src/types/actions';
import { initGame } from '../src/setup';
import { reduce } from '../src/reduce';
import { legalActions } from '../src/selectors';
import { currentPlayerId } from '../src/turn';
import { checkInvariants } from '../src/invariants';

export function makeConfig(
  numPlayers: number,
  seed: string | number,
  ruleParams?: GameConfig['ruleParams'],
): { board: Board; config: GameConfig } {
  const board = taiwanBoard();
  const players = Array.from({ length: numPlayers }, (_, i) => ({
    id: asPlayerId(`p${i}`),
    seat: i as SeatIndex,
  }));
  return { board, config: { seed, players, contentHash: CONTENT_HASH, ...(ruleParams ? { ruleParams } : {}) } };
}

function pick<T>(arr: readonly T[], rng: RngState): [T, RngState] {
  const [i, next] = nextInt(rng, arr.length);
  return [arr[i] as T, next];
}

/** A simple greedy policy: claim the longest affordable route, else draw, else anything. */
function chooseAction(board: Board, state: GameState, rng: RngState): [Action, RngState] {
  const phase = state.turn.phase;

  if (phase === 'SETUP_TICKETS') {
    const pid = state.turnOrder.find((id) => state.players[id as string]?.pendingTicketOffer);
    const offer = state.players[pid as string]?.pendingTicketOffer ?? [];
    return [
      { t: 'KEEP_INITIAL_TICKETS', player: pid!, keep: offer.slice(0, state.ruleParams.minKeepInitial) },
      rng,
    ];
  }

  const actor = currentPlayerId(state);

  if (phase === 'TICKET_SELECTION') {
    const offer = state.players[actor as string]?.pendingTicketOffer ?? [];
    return [{ t: 'KEEP_TICKETS', player: actor, keep: offer.slice(0, state.ruleParams.minKeepNormal) }, rng];
  }

  const acts = legalActions(board, state, actor);

  if (phase === 'TUNNEL_PENDING') {
    const commits = acts.filter((a) => a.t === 'RESOLVE_TUNNEL' && a.commit);
    if (commits.length) return pick(commits, rng);
    return pick(
      acts.filter((a) => a.t === 'RESOLVE_TUNNEL'),
      rng,
    );
  }

  if (phase === 'AWAIT_ACTION') {
    // Only consider tunnel claims we can guarantee committing. A naive greedy bot that claims a
    // tunnel on its base payment but cannot pay the worst-case surcharge will reveal → abort →
    // re-claim the same tunnel forever (revealed cards recycle through the discard, so the deck
    // never empties and no one's trains drop to trigger endgame) — the game never terminates.
    const claims = acts.filter((a): a is Action & { t: 'CLAIM_ROUTE'; routeId: RouteId; payment: Payment } => {
      if (a.t !== 'CLAIM_ROUTE') return false;
      const r = board.routeById.get(a.routeId as string);
      if (!r || !r.isTunnel) return true;
      const p = state.players[actor as string];
      if (!p) return false;
      const { color, colorCount, locomotives } = a.payment;
      const remLoco = p.hand.LOCOMOTIVE - locomotives;
      const remColor = color && colorCount > 0 ? p.hand[color] - colorCount : 0;
      return remColor + remLoco >= state.ruleParams.tunnelRevealCount;
    });
    if (claims.length) {
      let best = claims[0]!;
      let bestLen = board.routeById.get(best.routeId as string)?.length ?? 0;
      for (const a of claims) {
        const len = board.routeById.get(a.routeId as string)?.length ?? 0;
        if (len > bestLen) {
          best = a;
          bestLen = len;
        }
      }
      return [best, rng];
    }
    const draws = acts.filter((a) => a.t === 'DRAW_FACEUP' || a.t === 'DRAW_BLIND');
    if (draws.length) return pick(draws, rng);
    const nonPass = acts.filter((a) => a.t !== 'PASS');
    if (nonPass.length) return pick(nonPass, rng);
    return pick(acts, rng);
  }

  // DRAWING_CARDS
  return pick(acts, rng);
}

export interface PlayResult {
  finalState: GameState;
  log: Action[];
  turns: number;
  board: Board;
  config: GameConfig;
}

/** Drive a complete game with the greedy policy, asserting invariants after every action. */
export function playGreedyGame(
  numPlayers: number,
  seed: string | number,
  opts: { checkEachStep?: boolean; maxSteps?: number; ruleParams?: GameConfig['ruleParams'] } = {},
): PlayResult {
  const { board, config } = makeConfig(numPlayers, seed, opts.ruleParams);
  let state = initGame(board, config);
  let rng = makeRng(`policy:${seed}`);
  const log: Action[] = [];
  const maxSteps = opts.maxSteps ?? 20000;
  let steps = 0;

  while (state.turn.phase !== 'GAME_OVER' && steps < maxSteps) {
    const [action, nextRng] = chooseAction(board, state, rng);
    rng = nextRng;
    const res = reduce(board, state, action);
    if (!res.ok) {
      throw new Error(`policy produced illegal action ${action.t}: ${res.error.code} ${res.error.message}`);
    }
    state = res.value.state;
    log.push(action);
    if (opts.checkEachStep !== false) {
      const problems = checkInvariants(board, state);
      if (problems.length) throw new Error(`invariant violated after ${action.t}:\n${problems.join('\n')}`);
    }
    steps++;
  }

  return { finalState: state, log, turns: steps, board, config };
}

export { taiwanBoard, CONTENT_HASH };
