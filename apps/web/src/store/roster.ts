import { create } from 'zustand';
import type { RoomMember } from '../net/rest';

// The in-game snapshot carries player ids only (no display names) — names are lobby data.
// GameScreen fetches the room's members (REST) once on entry and stashes them here, keyed by
// userId (which is the player id the engine/snapshot uses), so the trackers, scoreboard and the
// whose-turn banner can show real account names / localized bot labels instead of "P{seat+1}".
interface RosterState {
  byId: Record<string, RoomMember>;
  setMembers(members: RoomMember[]): void;
  clear(): void;
}

export const useRoster = create<RosterState>()((set) => ({
  byId: {},
  setMembers: (members) => set({ byId: Object.fromEntries(members.map((m) => [m.userId, m])) }),
  clear: () => set({ byId: {} }),
}));
