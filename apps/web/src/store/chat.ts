import { create } from 'zustand';

export interface ChatMessage {
  id: number;
  playerId: string;
  text: string;
}

const CAP = 500;

interface ChatState {
  messages: ChatMessage[];
  nextId: number;
  /** The most recently INGESTED live message (never set by ingestHistory) — lets consumers like the
   *  sound driver react to genuinely new chat only, never to a reconnect's history backfill. */
  lastLive: ChatMessage | null;
  ingest(msg: { playerId: string; text: string }): void;
  ingestHistory(msgs: { playerId: string; text: string }[]): void;
  reset(): void;
}

export const useChat = create<ChatState>()((set) => ({
  messages: [],
  nextId: 1,
  lastLive: null,
  ingest: (msg) =>
    set((s) => {
      const message = { id: s.nextId, ...msg };
      return {
        messages: [...s.messages, message].slice(-CAP),
        nextId: s.nextId + 1,
        lastLive: message,
      };
    }),
  // The server re-sends the complete chat log on every (re)connect (before live messages);
  // replace so a transient reconnect re-fills the gap. Live messages then append.
  ingestHistory: (msgs) =>
    set(() => {
      const messages = msgs.map((m, i) => ({ id: i + 1, ...m }));
      return { messages: messages.slice(-CAP), nextId: messages.length + 1 };
    }),
  reset: () => set({ messages: [], nextId: 1, lastLive: null }),
}));
