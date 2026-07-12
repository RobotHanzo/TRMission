// Builds the GameConfig for a new offline game — the serverless mirror of
// LobbyService.start (apps/server/src/lobby/lobby.service.ts): human on seat 0,
// bots on seats 1..n, the map's curated rules + the room-default variant flags.
// Randomness (gameId, seed) is INJECTED — expo-crypto on device, fixed strings in tests —
// so this module stays pure and the engine's determinism boundary is preserved.
import { BOT_ID_PREFIX } from '@trm/bots';
import type { BotDifficulty, BotProfile } from '@trm/bots';
import { ENGINE_VERSION } from '@trm/engine';
import type { GameConfig, PlayerSeed } from '@trm/engine';
import { officialMapById } from '@trm/map-data';
import { asPlayerId } from '@trm/shared';
import type { SeatIndex } from '@trm/shared';
import { LOCAL_HUMAN_ID, type OfflineGameSetup } from './types';

export interface NewOfflineGameOptions {
  readonly mapId: string;
  readonly botCount: 1 | 2 | 3 | 4;
  readonly difficulty: BotDifficulty;
  /** Injected randomness (see seed.ts). */
  readonly gameId: string;
  readonly seed: string;
}

/** Mirror of the server's DEFAULT_ROOM_SETTINGS rule-variant flags (room.repo.ts), fed into the
 *  engine at start exactly as LobbyService.start does (a disjoint merge over the map's curated
 *  rules — the variant-flag keys never overlap the map's RULE_BOUNDS keys). */
const DEFAULT_VARIANT_FLAGS = {
  unlimitedStationBorrow: true,
  secondDrawAfterBlindRainbow: false,
  noUnfinishedTicketPenalty: false,
  doubleRouteSingleFor23: true,
  eventsMode: 'off',
} as const;

export function newOfflineSetup(opts: NewOfflineGameOptions): OfflineGameSetup {
  const map = officialMapById(opts.mapId);
  if (!map) throw new Error(`unknown official map: ${opts.mapId}`);
  const bots: BotProfile[] = Array.from({ length: opts.botCount }, (_, i) => ({
    playerId: `${BOT_ID_PREFIX}local-${i + 1}`,
    difficulty: opts.difficulty,
  }));
  const players: PlayerSeed[] = [
    { id: asPlayerId(LOCAL_HUMAN_ID), seat: 0 as SeatIndex },
    ...bots.map((b, i) => ({ id: asPlayerId(b.playerId), seat: (i + 1) as SeatIndex })),
  ];
  const config: GameConfig = {
    seed: opts.seed,
    players,
    contentHash: map.hash,
    ruleParams: { ...(map.content.rules ?? {}), ...DEFAULT_VARIANT_FLAGS },
  };
  return {
    gameId: opts.gameId,
    config,
    bots,
    mapId: opts.mapId,
    engineVersion: ENGINE_VERSION,
  };
}
