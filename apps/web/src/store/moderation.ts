// The account's client-side mute list (Apple 1.2 / Play UGC), bound to the web REST client.
// The store itself lives in @trm/client-core so web and mobile mute identically; blocking is
// display-only — it filters chat, masks the blocked player's name and picture, and never
// touches game state, seating, or matchmaking.
import { createModerationStore } from '@trm/client-core/store/moderation';
import { api } from '../net/rest';

export { canModerate } from '@trm/client-core/store/moderation';
export type { ModerationState } from '@trm/client-core/store/moderation';

export const useModeration = createModerationStore(api);
