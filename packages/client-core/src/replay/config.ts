// The ONE place that rebuilds an engine `GameConfig` from a replay payload, shared by every
// replay surface (web + mobile player, web admin viewer). Every key here feeds `initGame`, so a
// missing one does not fail loudly: genesis renders fine, then the first recorded action is
// rejected against a state that never existed and the screen falls back to "not replayable"
// (issue #75 — `teamCount` was the key that went missing). Add new `GameConfig` keys here.
import type { GameConfig } from '@trm/engine';
import { asPlayerId, type RuleParams, type SeatIndex } from '@trm/shared';
import type { ReplayPayload } from '../net/restTypes';

export function replayGameConfig(config: ReplayPayload['config']): GameConfig {
  return {
    seed: config.seed,
    players: config.players.map((p) => ({ id: asPlayerId(p.id), seat: p.seat as SeatIndex })),
    contentHash: config.contentHash,
    ...(config.ruleParams ? { ruleParams: config.ruleParams as Partial<RuleParams> } : {}),
    ...(config.shuffleTurnOrder !== undefined ? { shuffleTurnOrder: config.shuffleTurnOrder } : {}),
    // v12 team mode: teams rotate the genesis turn order (one draw) where a free-for-all shuffles
    // it, and they gate the team-pool actions. 0 is the server's "free-for-all" spelling.
    ...(config.teamCount !== undefined && config.teamCount > 0
      ? { teamCount: config.teamCount }
      : {}),
    // CWE-331: apply the widened-RNG-key flag so a v13 replay reproduces the wide stream.
    ...(config.wideSeed !== undefined ? { wideSeed: config.wideSeed } : {}),
  };
}
