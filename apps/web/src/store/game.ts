import { create } from 'zustand';
import type { GameSnapshot, GameEvent } from '@trm/proto';
import type { SocketStatus } from '../net/socket';

export interface RejectionInfo {
  code: number;
  messageKey: string;
}

interface GameState {
  snapshot: GameSnapshot | null;
  status: SocketStatus;
  recentEvents: GameEvent[];
  rejection: RejectionInfo | null;
  applySnapshot(snapshot: GameSnapshot): void;
  applyEvents(stateVersion: number, events: GameEvent[]): void;
  setStatus(status: SocketStatus): void;
  setRejection(rejection: RejectionInfo | null): void;
  reset(): void;
}

export const useGame = create<GameState>()((set) => ({
  snapshot: null,
  status: 'closed',
  recentEvents: [],
  rejection: null,
  // Snapshot is authoritative; ignore any that arrives out of order (older version).
  applySnapshot: (snapshot) =>
    set((s) => (s.snapshot && s.snapshot.stateVersion > snapshot.stateVersion ? s : { snapshot })),
  applyEvents: (_v, events) =>
    set((s) => ({ recentEvents: [...s.recentEvents, ...events].slice(-50) })),
  setStatus: (status) => set({ status }),
  setRejection: (rejection) => set({ rejection }),
  reset: () => set({ snapshot: null, recentEvents: [], rejection: null }),
}));
