import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { BlockList } from '../net/restTypes';

/**
 * The account's client-side mute list, mirrored locally (Apple 1.2 / Play UGC).
 * Blocking filters chat display and masks the blocked player's UGC display name and picture —
 * it never touches game state, seating, or matchmaking.
 *
 * Shared by web and mobile. The REST client is injected rather than imported, because each app
 * builds its own with its own transport (same pattern as the rest of this package).
 */
export interface ModerationApi {
  myBlocks(): Promise<BlockList>;
  blockUser(userId: string): Promise<void>;
  unblockUser(userId: string): Promise<void>;
}

export interface ModerationState {
  blocked: Set<string>;
  hydrated: boolean;
  hydrate(): Promise<void>;
  block(userId: string): Promise<void>;
  unblock(userId: string): Promise<void>;
  reset(): void;
}

export type ModerationStore = UseBoundStore<StoreApi<ModerationState>>;

export function createModerationStore(api: ModerationApi): ModerationStore {
  return create<ModerationState>()((set, get) => ({
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
}

/**
 * Report/block applies to real other humans only — bots have no account to report and you
 * cannot moderate yourself. Gate every affordance with this before offering it.
 */
export const canModerate = (targetId: string, meId: string | null): boolean =>
  targetId !== meId && !targetId.startsWith('bot:');
