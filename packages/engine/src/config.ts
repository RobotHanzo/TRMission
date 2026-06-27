import type { PlayerId, SeatIndex, RuleParams } from '@trm/shared';

export interface PlayerSeed {
  readonly id: PlayerId;
  readonly seat: SeatIndex;
}

export interface GameConfig {
  /** Seed string/number; the entire game replays from this + the action log. */
  readonly seed: string | number;
  /** 2–5 players. Turn order follows this array unless `shuffleTurnOrder`. */
  readonly players: readonly PlayerSeed[];
  /** Partial overrides applied over DEFAULT_RULE_PARAMS. */
  readonly ruleParams?: Partial<RuleParams>;
  /** If true, the starting turn order is RNG-shuffled (else uses `players` order). */
  readonly shuffleTurnOrder?: boolean;
  /** Pins the game to exact authored content (ADR A6/A13). */
  readonly contentHash: string;
}

/** Player counts of 2–3 use the "only one of each double-route" variant (SINGLE_ONLY). */
export type DoubleRouteVariant = 'SINGLE_ONLY' | 'BOTH';

export const variantForPlayerCount = (n: number): DoubleRouteVariant =>
  n <= 3 ? 'SINGLE_ONLY' : 'BOTH';
