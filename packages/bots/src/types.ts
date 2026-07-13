// Bot players. A bot is a full participant in the authoritative game — it occupies a
// seat, takes ordinary turns, and is driven entirely server-side (the engine never
// knows a player is a bot). `difficulty` selects a policy in ./policy.
export type BotDifficulty = 'EASY' | 'MEDIUM' | 'HARD' | 'HELL';

export const BOT_DIFFICULTIES: readonly BotDifficulty[] = ['EASY', 'MEDIUM', 'HARD', 'HELL'];

export interface BotProfile {
  /** Engine PlayerId for this bot (always `bot:<uuid>` — see isBotId). */
  readonly playerId: string;
  readonly difficulty: BotDifficulty;
}

/** Bot player ids are namespaced so the client (and humans) can tell them apart. */
export const BOT_ID_PREFIX = 'bot:';
export const isBotId = (id: string): boolean => id.startsWith(BOT_ID_PREFIX);
