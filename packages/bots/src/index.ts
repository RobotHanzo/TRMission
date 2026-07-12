// Public API of the bot policy package: a pure, deterministic move chooser usable by
// the authoritative server driver AND the mobile offline LocalGameSession.
export { chooseBotAction } from './policy';
export { BOT_DIFFICULTIES, BOT_ID_PREFIX, isBotId } from './types';
export type { BotDifficulty, BotProfile } from './types';
