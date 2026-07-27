// The account's client-side mute list (Apple 1.2 / Play UGC). The store moved to
// @trm/client-core (shared web+mobile); this file binds it to the mobile REST client.
import { createModerationStore } from '@trm/client-core/store/moderation';
import { api } from '../net/rest';

export { canModerate } from '@trm/client-core/store/moderation';
export type { ModerationState } from '@trm/client-core/store/moderation';

export const useModeration = createModerationStore(api);
