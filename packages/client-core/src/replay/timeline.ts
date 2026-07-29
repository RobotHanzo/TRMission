// The shape of a finished game, read straight off its action log: which run of actions was whose
// turn, and where the moments worth scrubbing to landed. Pure derivation from `Action[]` — no
// engine replay, no I/O — so a replay transport can draw the whole game before step 1 is applied.
import type { Action } from '@trm/engine';

/**
 * A moment rare enough to be worth its own mark on a strip. Claiming track is the everyday move —
 * forty of them per game, which as forty glyphs is a smear rather than a signal — so it lives on
 * the turn as `track` instead. What is left is the handful of turns someone will want to find
 * again: a station going up, a tunnel gamble.
 */
export type ReplayMomentKind = 'station' | 'tunnel';

export interface ReplayTurn {
  /** Steps [from, to). A step is "n actions applied", so action i is applied at step i + 1. */
  readonly from: number;
  readonly to: number;
  /** Empty for the opening draft, which belongs to the whole table. */
  readonly player: string;
  /** -1 for the opening draft. */
  readonly seat: number;
  /** 1-based turn number; 0 for the opening draft. */
  readonly index: number;
  readonly setup: boolean;
  /** Routes claimed or repaired this turn. Turning cards into track is the move that moves a game,
   *  so a transport can weight the turn by it and skip drawing every claim separately. */
  readonly track: number;
}

export interface ReplayMoment {
  /** The step that lands ON this moment — seek here and it is the latest action applied. */
  readonly step: number;
  readonly kind: ReplayMomentKind;
  readonly seat: number;
  readonly player: string;
}

export interface ReplayTimeline {
  readonly turns: readonly ReplayTurn[];
  readonly moments: readonly ReplayMoment[];
  readonly total: number;
  /** Played turns only — the opening draft is not one. */
  readonly turnCount: number;
}

const momentKind = (action: Action): ReplayMomentKind | null => {
  switch (action.t) {
    // Either outcome: the drama is the reveal, and an abort is exactly the turn you want to find.
    case 'RESOLVE_TUNNEL':
      return 'tunnel';
    case 'BUILD_STATION':
      return 'station';
    default:
      return null;
  }
};

/** Did this action put track on the board? A tunnel claim is two actions (CLAIM_ROUTE →
 *  RESOLVE_TUNNEL) and only counts once, and not at all if the player backed out of the bore. */
const laysTrack = (action: Action, next: Action | undefined): boolean => {
  if (action.t === 'REPAIR_ROUTE') return true;
  if (action.t !== 'CLAIM_ROUTE') return false;
  return !(next?.t === 'RESOLVE_TUNNEL' && next.player === action.player && !next.commit);
};

/**
 * Group an action log into turns and moments. A turn is a maximal run of consecutive actions by
 * one player, which is exactly what the rules produce: turn order rotates, and every free or
 * follow-up action (the second card draw, a tunnel resolve, a team-pool push) stays with the
 * player who opened the turn.
 */
export function buildReplayTimeline(
  actions: readonly Action[],
  seats: ReadonlyMap<string, number>,
): ReplayTimeline {
  const turns: ReplayTurn[] = [];
  const moments: ReplayMoment[] = [];
  let played = 0;
  let i = 0;

  // The opening mission draft is simultaneous — every seat resolves its initial offer before
  // anyone takes a turn. Collapsed into ONE segment, because n one-action "turns" would read as
  // a round of play that never happened.
  if (actions[0]?.t === 'KEEP_INITIAL_TICKETS') {
    while (actions[i]?.t === 'KEEP_INITIAL_TICKETS') i++;
    turns.push({ from: 0, to: i, player: '', seat: -1, index: 0, setup: true, track: 0 });
  }

  while (i < actions.length) {
    const player = actions[i]!.player as string;
    const from = i;
    let track = 0;
    while (i < actions.length && (actions[i]!.player as string) === player) {
      if (laysTrack(actions[i]!, actions[i + 1])) track += 1;
      i++;
    }
    played += 1;
    const seat = seats.get(player) ?? 0;
    turns.push({ from, to: i, player, seat, index: played, setup: false, track });
  }

  for (let k = 0; k < actions.length; k++) {
    const action = actions[k]!;
    const kind = momentKind(action);
    if (!kind) continue;
    const player = action.player as string;
    moments.push({ step: k + 1, kind, player, seat: seats.get(player) ?? 0 });
  }

  return { turns, moments, total: actions.length, turnCount: played };
}

/** The turn a step is sitting inside — the one holding the last applied action. Null before the
 *  first action, when there is nothing to be inside of. */
export function turnAtStep(timeline: ReplayTimeline, step: number): ReplayTurn | null {
  if (step <= 0) return null;
  return timeline.turns.find((turn) => step > turn.from && step <= turn.to) ?? null;
}

/** Seek targets for turn-at-a-time stepping: the start of the log, then the end of every turn.
 *  Every landing point is a turn that has just finished, so the two directions are symmetric. */
export function turnBoundaries(timeline: ReplayTimeline): number[] {
  return [0, ...timeline.turns.map((turn) => turn.to)];
}
