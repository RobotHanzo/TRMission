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
  ingest(msg: { playerId: string; text: string }): void;
  ingestHistory(msgs: { playerId: string; text: string }[]): void;
  reset(): void;
}

export const useChat = create<ChatState>()((set) => ({
  messages: [],
  nextId: 1,
  ingest: (msg) =>
    set((s) => ({
      messages: [...s.messages, { id: s.nextId, ...msg }].slice(-CAP),
      nextId: s.nextId + 1,
    })),
  ingestHistory: (msgs) =>
    set((s) => {
      if (s.messages.length > 0) return s;
      const messages = msgs.map((m, i) => ({ id: i + 1, ...m }));
      return { messages: messages.slice(-CAP), nextId: messages.length + 1 };
    }),
  reset: () => set({ messages: [], nextId: 1 }),
}));
