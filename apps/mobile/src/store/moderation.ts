import { create } from 'zustand';
import { api } from '../net/rest';

/**
 * The account's client-side mute list, mirrored locally (Apple 1.2 / Play UGC).
 * Blocking filters chat display and masks the blocked player's UGC display name —
 * it never touches game state, seating, or matchmaking.
 */
interface ModerationState {
  blocked: Set<string>;
  hydrated: boolean;
  hydrate(): Promise<void>;
  block(userId: string): Promise<void>;
  unblock(userId: string): Promise<void>;
  reset(): void;
}

export const useModeration = create<ModerationState>()((set, get) => ({
  blocked: new Set<string>(),
  hydrated: false,
  async hydrate() {
    try {
      const { blockedUserIds } = await api.myBlocks();
      set({ blocked: new Set(blockedUserIds), hydrated: true });
    } catch {
      /* non-fatal: filtering stays off until the next hydrate */
    }
  },
  async block(userId) {
    const next = new Set(get().blocked);
    next.add(userId);
    set({ blocked: next }); // optimistic
    try {
      await api.blockUser(userId);
    } catch {
      const rollback = new Set(get().blocked);
      rollback.delete(userId);
      set({ blocked: rollback });
    }
  },
  async unblock(userId) {
    const next = new Set(get().blocked);
    next.delete(userId);
    set({ blocked: next });
    try {
      await api.unblockUser(userId);
    } catch {
      const rollback = new Set(get().blocked);
      rollback.add(userId);
      set({ blocked: rollback });
    }
  },
  reset() {
    set({ blocked: new Set<string>(), hydrated: false });
  },
}));
