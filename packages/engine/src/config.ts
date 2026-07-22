import type { PlayerId, SeatIndex, RuleParams } from '@trm/shared';

export interface PlayerSeed {
  readonly id: PlayerId;
  readonly seat: SeatIndex;
}

export interface GameConfig {
  /** Seed string/number; the entire game replays from this + the action log. */
  readonly seed: string | number;
  /** 2–5 players free-for-all, or 4/6 in a team game. Turn order follows this array unless
   *  `shuffleTurnOrder`. */
  readonly players: readonly PlayerSeed[];
  /**
   * Team game: how many teams share this table. Absent ⇒ free-for-all, and the resulting state
   * carries no team keys at all (byte-identical to a pre-v12 game). Together with the seated
   * player count this pins the layout exactly: 4p/2 = two pairs, 6p/3 = three pairs, 6p/2 = two
   * trios. Membership is `seat % teamCount`, so partners are always interleaved around the table.
   */
  readonly teamCount?: number;
  /** Partial overrides applied over DEFAULT_RULE_PARAMS. */
  readonly ruleParams?: Partial<RuleParams>;
  /** If true, the starting turn order is RNG-shuffled (else uses `players` order). */
  readonly shuffleTurnOrder?: boolean;
  /** Pins the game to exact authored content (ADR A6/A13). */
  readonly contentHash: string;
}

/**
 * How many tracks of a parallel group (2 or 3 routes between one pair) may be claimed.
 * With `doubleRouteSingleFor23` on (the default), the count scales with the player count:
 * 2–3p → 1, 4p → 2, 5p → 3 (clamped to the group's size), which is exactly the historical
 * double behavior (2 open at 4–5p, 1 open at 2–3p). With the flag off, every track is open.
 */
export const openTrackCount = (
  groupSize: number,
  playerCount: number,
  singleFor23: boolean,
): number => (singleFor23 ? Math.min(groupSize, Math.max(1, playerCount - 2)) : groupSize);
