import { create } from 'zustand';
import type { RoomMember, RoomSpectator } from '../net/rest';

// The in-game snapshot carries player ids only (no display names) — names are lobby data.
// GameScreen fetches the room's members + spectators (REST) once on entry and stashes them
// here, keyed by userId (which is the id the engine/snapshot/chat use), so the trackers,
// scoreboard, whose-turn banner, and chat can show real account names / localized bot labels
// instead of "P{seat+1}" — including for someone watching rather than seated.
export interface RosterEntry {
  displayName: string;
  isBot?: boolean;
  difficulty?: RoomMember['difficulty'];
  isSpectator?: boolean;
}

interface RosterState {
  byId: Record<string, RosterEntry>;
  setMembers(members: RoomMember[], spectators?: RoomSpectator[]): void;
  clear(): void;
}

export const useRoster = create<RosterState>()((set) => ({
  byId: {},
  setMembers: (members, spectators = []) =>
    set({
      byId: {
        ...Object.fromEntries(members.map((m) => [m.userId, m])),
        ...Object.fromEntries(spectators.map((s) => [s.userId, { ...s, isSpectator: true }])),
      },
    }),
  clear: () => set({ byId: {} }),
}));
