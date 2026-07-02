import { create, useStore, type StateCreator } from 'zustand';
import { createContext, useContext } from 'react';
import type { GameEvent } from '@trm/proto';
import { entriesFromEvents, type LogEntry } from '../game/logModel';

const CAP = 1000;

interface LogState {
  entries: LogEntry[];
  nextId: number;
  ingestLive(events: GameEvent[]): void;
  ingestHistory(events: GameEvent[]): void;
  reset(): void;
}

const creator: StateCreator<LogState> = (set) => ({
  entries: [],
  nextId: 1,
  ingestLive: (events) =>
    set((s) => {
      const datas = entriesFromEvents(events);
      if (datas.length === 0) return s;
      let id = s.nextId;
      const entries = [...s.entries];
      for (const d of datas) entries.push({ id: id++, ...d });
      return { entries: entries.slice(-CAP), nextId: id };
    }),
  // History is the server's COMPLETE backfill, re-sent on every (re)connect and always
  // delivered before any live event on that connection. Replace the store with it so a
  // transient reconnect re-fills the disconnect-window gap; live events then append.
  ingestHistory: (events) =>
    set(() => {
      const entries = entriesFromEvents(events).map((d, i) => ({ id: i + 1, ...d }));
      return { entries: entries.slice(-CAP), nextId: entries.length + 1 };
    }),
  reset: () => set({ entries: [], nextId: 1 }),
});

/** The live game's log singleton (the WebSocket bridge in net/connection.ts writes here). */
export const useLog = create<LogState>()(creator);

/** Create an ISOLATED log store (replay/sandbox) — mirrors store/game.ts's contextual pattern. */
export const createLogStore = () => create<LogState>()(creator);

export type LogStoreApi = typeof useLog;
const LogStoreContext = createContext<LogStoreApi | null>(null);
export const LogStoreProvider = LogStoreContext.Provider;

/** Subscribe to the contextual log store — the isolated one under a provider, else the singleton. */
export function useLogStore<T>(selector: (s: LogState) => T): T {
  const store = useContext(LogStoreContext) ?? useLog;
  return useStore(store, selector);
}

/** The contextual store object itself, for imperative `.getState()` use in effects/hooks. */
export function useLogStoreApi(): LogStoreApi {
  return useContext(LogStoreContext) ?? useLog;
}
