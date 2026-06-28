import { create } from 'zustand';
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

export const useLog = create<LogState>()((set) => ({
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
  // History is a one-shot backfill delivered before live events; ignore if already filled.
  ingestHistory: (events) =>
    set((s) => {
      if (s.entries.length > 0) return s;
      const entries = entriesFromEvents(events).map((d, i) => ({ id: i + 1, ...d }));
      return { entries: entries.slice(-CAP), nextId: entries.length + 1 };
    }),
  reset: () => set({ entries: [], nextId: 1 }),
}));
