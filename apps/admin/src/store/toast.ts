import { create } from 'zustand';

export type ToastKind = 'success' | 'error';

export interface ToastCue {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastState {
  toasts: ToastCue[];
  push(kind: ToastKind, message: string): void;
  remove(id: number): void;
  reset(): void;
}

let counter = 0;
const nextId = (): number => ++counter;

export const useToast = create<ToastState>()((set) => ({
  toasts: [],
  push: (kind, message) =>
    set((s) => ({ toasts: [...s.toasts, { id: nextId(), kind, message }] })),
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((c) => c.id !== id) })),
  reset: () => set({ toasts: [] }),
}));
