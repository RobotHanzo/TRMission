import { create, useStore, type StateCreator } from 'zustand';
import { createContext, useContext } from 'react';
import type { GameSnapshot, GameEvent, CameraView } from '@trm/proto';
import type { SocketStatus } from '../net/socket';
import type { CameraState as ViewDescriptor } from '../board/camera';

export interface RejectionInfo {
  code: number;
  messageKey: string;
}

/** The current acting player's relayed camera framing (ephemeral, cosmetic). */
export interface ActingCamera {
  playerId: string;
  view: ViewDescriptor;
}

/** The most recent event batch, with a monotonic `seq` so animation consumers fire once per batch. */
export interface EventBatch {
  seq: number;
  events: GameEvent[];
}

interface GameState {
  snapshot: GameSnapshot | null;
  status: SocketStatus;
  recentEvents: GameEvent[];
  /** Latest delivered batch (animation hint channel); null until the first batch / after reset. */
  lastBatch: EventBatch | null;
  rejection: RejectionInfo | null;
  /** Set when this connection was force-closed because another connection took the same seat. */
  sessionReplaced: boolean;
  /** Latest camera framing broadcast by a member; consumed by "follow the acting player". */
  actingCamera: ActingCamera | null;
  applySnapshot(snapshot: GameSnapshot): void;
  applyEvents(stateVersion: number, events: GameEvent[]): void;
  applyCameraMoved(playerId: string, view: CameraView): void;
  setStatus(status: SocketStatus): void;
  setRejection(rejection: RejectionInfo | null): void;
  setSessionReplaced(sessionReplaced: boolean): void;
  reset(): void;
}

const creator: StateCreator<GameState> = (set) => ({
  snapshot: null,
  status: 'closed',
  recentEvents: [],
  lastBatch: null,
  rejection: null,
  sessionReplaced: false,
  actingCamera: null,
  // Snapshot is authoritative; ignore any that arrives out of order (older version).
  // A turn handover (current player changed) drops any stale follow-camera so the next
  // actor's framing starts clean rather than snapping to the previous player's last view.
  applySnapshot: (snapshot) =>
    set((s) => {
      if (s.snapshot && s.snapshot.stateVersion > snapshot.stateVersion) return s;
      const turnChanged = s.snapshot?.currentPlayerId !== snapshot.currentPlayerId;
      return turnChanged ? { snapshot, actingCamera: null } : { snapshot };
    }),
  applyEvents: (_v, events) =>
    set((s) => ({
      recentEvents: [...s.recentEvents, ...events].slice(-50),
      lastBatch: { seq: (s.lastBatch?.seq ?? 0) + 1, events },
    })),
  // Keep only the framing of whoever is acting right now; ignore relays from anyone else.
  applyCameraMoved: (playerId, view) =>
    set((s) =>
      s.snapshot?.currentPlayerId === playerId
        ? { actingCamera: { playerId, view: { cx: view.cx, cy: view.cy, span: view.span } } }
        : s,
    ),
  setStatus: (status) => set({ status }),
  setRejection: (rejection) => set({ rejection }),
  setSessionReplaced: (sessionReplaced) => set({ sessionReplaced }),
  reset: () =>
    set({
      snapshot: null,
      recentEvents: [],
      lastBatch: null,
      rejection: null,
      sessionReplaced: false,
      actingCamera: null,
    }),
});

/** The live game's store singleton (the WebSocket client writes here; app chrome reads here). */
export const useGame = create<GameState>()(creator);

/** Create an ISOLATED game store instance. The in-game encyclopedia uses one so its sandbox replay
 *  never touches the live game's store (the live snapshot keeps flowing into `useGame` behind it). */
export const createGameStore = () => create<GameState>()(creator);

export type GameStoreApi = typeof useGame;
const GameStoreContext = createContext<GameStoreApi | null>(null);
export const GameStoreProvider = GameStoreContext.Provider;

/** Subscribe to the contextual game store — the isolated one under a `GameStoreProvider`, else the
 *  live singleton. In-game board/HUD components use this so they can be re-pointed at a sandbox. */
export function useGameStore<T>(selector: (s: GameState) => T): T {
  const store = useContext(GameStoreContext) ?? useGame;
  return useStore(store, selector);
}

/** The contextual store object itself — for imperative `.getState()` reads inside effects/callbacks
 *  (the driver hooks read the latest snapshot this way to dodge stale closures). */
export function useGameStoreApi(): GameStoreApi {
  return useContext(GameStoreContext) ?? useGame;
}
