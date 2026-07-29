// The shape of a finished game, read straight off its action log: which run of actions was whose
// turn, and where the moments worth scrubbing to landed. Pure derivation from `Action[]` — no
// engine replay, no I/O — so a replay transport can draw the whole game before step 1 is applied.
import type { Action } from '@trm/engine';

/**
 * A moment a viewer would actually seek to. Deliberately short: track going down, a station going
 * up, a tunnel gamble, a repair. Card draws and ticket picks are the connective tissue between
 * them and would swamp the strip without telling anyone anything.
 */
export type ReplayMomentKind = 'claim' | 'station' | 'tunnel' | 'repair';

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

/** A tunnel claim is two actions (CLAIM_ROUTE → RESOLVE_TUNNEL); the resolve carries the outcome,
 *  so it owns the marker rather than the pair stamping two glyphs side by side. */
const momentKind = (action: Action, next: Action | undefined): ReplayMomentKind | null => {
  switch (action.t) {
    case 'CLAIM_ROUTE':
      return next?.t === 'RESOLVE_TUNNEL' && next.player === action.player ? null : 'claim';
    case 'RESOLVE_TUNNEL':
      return 'tunnel';
    case 'BUILD_STATION':
      return 'station';
    case 'REPAIR_ROUTE':
      return 'repair';
    default:
      return null;
  }
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
    turns.push({ from: 0, to: i, player: '', seat: -1, index: 0, setup: true });
  }

  while (i < actions.length) {
    const player = actions[i]!.player as string;
    const from = i;
    while (i < actions.length && (actions[i]!.player as string) === player) i++;
    played += 1;
    turns.push({ from, to: i, player, seat: seats.get(player) ?? 0, index: played, setup: false });
  }

  for (let k = 0; k < actions.length; k++) {
    const action = actions[k]!;
    const kind = momentKind(action, actions[k + 1]);
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
