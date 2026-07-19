import { create, useStore, type StateCreator } from 'zustand';
import { createContext, useContext } from 'react';
import type { GameEvent } from '@trm/proto';
import {
  connectionLogDatum,
  entriesFromEvents,
  seatControlDatum,
  type LogDatum,
  type LogEntry,
} from '../game/logModel';

const CAP = 1000;

/** A backfilled player-connection change, positioned at a splice point within the SAME
 *  `HistoryReplay`'s `events` array (see `net/socket.ts`'s `onHistory`). */
export interface ConnectionLogBackfillEntry {
  playerId: string;
  connected: boolean;
  afterEventIndex: number;
}

interface LogState {
  entries: LogEntry[];
  nextId: number;
  ingestLive(events: GameEvent[]): void;
  ingestHistory(events: GameEvent[], connectionLog?: ConnectionLogBackfillEntry[]): void;
  ingestConnectionChange(playerId: string, connected: boolean): void;
  ingestSeatControlChange(playerId: string, botControlled: boolean): void;
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
  ingestConnectionChange: (playerId, connected) =>
    set((s) => {
      const entries = [...s.entries, { id: s.nextId, ...connectionLogDatum(playerId, connected) }];
      return { entries: entries.slice(-CAP), nextId: s.nextId + 1 };
    }),
  ingestSeatControlChange: (playerId, botControlled) =>
    set((s) => {
      const entries = [...s.entries, { id: s.nextId, ...seatControlDatum(playerId, botControlled) }];
      return { entries: entries.slice(-CAP), nextId: s.nextId + 1 };
    }),
  // History is the server's COMPLETE backfill, re-sent on every (re)connect and always
  // delivered before any live event on that connection. Replace the store with it so a
  // transient reconnect re-fills the disconnect-window gap; live events then append.
  // Connection-log entries are interleaved at their recorded splice point — event-by-event
  // (rather than batching entriesFromEvents over the whole array) so `afterEventIndex` (a
  // position within the RAW `events` array) lines up even though noisy events are filtered out.
  ingestHistory: (events, connectionLog = []) =>
    set(() => {
      const byIndex = new Map<number, ConnectionLogBackfillEntry[]>();
      for (const c of connectionLog) {
        const arr = byIndex.get(c.afterEventIndex);
        if (arr) arr.push(c);
        else byIndex.set(c.afterEventIndex, [c]);
      }
      const datas: LogDatum[] = [];
      const pushConnAt = (idx: number): void => {
        for (const c of byIndex.get(idx) ?? [])
          datas.push(connectionLogDatum(c.playerId, c.connected));
      };
      pushConnAt(0);
      events.forEach((e, i) => {
        datas.push(...entriesFromEvents([e]));
        pushConnAt(i + 1);
      });
      const entries = datas.map((d, i) => ({ id: i + 1, ...d }));
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
