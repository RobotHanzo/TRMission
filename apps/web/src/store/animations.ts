import { create } from 'zustand';
import type { CardColor } from '@trm/shared';
import type { AnimIntent } from '../game/animationModel';

/**
 * Transient, view-only animation state. Components render from these slices; the
 * `useAnimationDriver` hook feeds them via `pushIntent`. Entries self-expire (consumers call the
 * matching `remove*`/`clear*` on animation/timer end). Nothing here is game truth.
 */

export interface Flight {
  id: number;
  toPlayerId: string;
  faceUp: boolean;
  color: CardColor | null;
  slot: number | null;
}
export interface Float {
  id: number;
  playerId: string;
  amount: number;
}
export interface Sweep {
  id: number;
  seat: number;
  path: string[];
}
export interface TicketCue {
  id: number;
  playerId: string;
  ticketId: string;
  seat: number;
}
export interface TurnCue {
  id: number;
  playerId: string;
  isYou: boolean;
}
export interface Fanfare {
  id: number;
  ticketId: string;
  long: boolean;
  seat: number;
}

interface AnimState {
  glowingRoutes: Map<string, number>;
  glowingStations: Map<string, number>;
  flights: Flight[];
  floats: Float[];
  sweeps: Sweep[];
  ticketCues: TicketCue[];
  turnCue: TurnCue | null;
  marketFlips: Set<number>;
  /** Refilled slots held face-down until the current draw finishes (revealed via `revealMarketSlots`). */
  coveredMarketSlots: Set<number>;
  fanfare: Fanfare | null;
  fanfareQueue: Fanfare[];
  pushIntent(intent: AnimIntent): void;
  clearGlowRoute(id: string): void;
  clearGlowStation(id: string): void;
  removeFlight(id: number): void;
  removeFloat(id: number): void;
  removeSweep(id: number): void;
  removeTicketCue(id: number): void;
  clearTurnCue(id: number): void;
  clearMarketFlip(slot: number): void;
  /** Flip every covered slot into view (called when a draw completes). */
  revealMarketSlots(): void;
  dismissFanfare(): void;
  reset(): void;
}

let counter = 0;
const nextId = (): number => ++counter;

const initial = () => ({
  glowingRoutes: new Map<string, number>(),
  glowingStations: new Map<string, number>(),
  flights: [] as Flight[],
  floats: [] as Float[],
  sweeps: [] as Sweep[],
  ticketCues: [] as TicketCue[],
  turnCue: null as TurnCue | null,
  marketFlips: new Set<number>(),
  coveredMarketSlots: new Set<number>(),
  fanfare: null as Fanfare | null,
  fanfareQueue: [] as Fanfare[],
});

export const useAnimations = create<AnimState>()((set) => ({
  ...initial(),

  pushIntent: (intent) =>
    set((s) => {
      switch (intent.kind) {
        case 'glowRoute': {
          const m = new Map(s.glowingRoutes);
          m.set(intent.routeId, intent.seat);
          return { glowingRoutes: m };
        }
        case 'glowStation': {
          const m = new Map(s.glowingStations);
          m.set(intent.cityId, intent.seat);
          return { glowingStations: m };
        }
        case 'cardFly':
          return {
            flights: [
              ...s.flights,
              {
                id: nextId(),
                toPlayerId: intent.toPlayerId,
                faceUp: intent.faceUp,
                color: intent.color,
                slot: intent.slot,
              },
            ],
          };
        case 'scoreFloat':
          return { floats: [...s.floats, { id: nextId(), playerId: intent.playerId, amount: intent.amount }] };
        case 'turnCue':
          return { turnCue: { id: nextId(), playerId: intent.playerId, isYou: intent.isYou } };
        case 'marketFlip': {
          const set2 = new Set(s.marketFlips);
          set2.add(intent.slot);
          return { marketFlips: set2 };
        }
        case 'marketCover': {
          const covered = new Set(s.coveredMarketSlots);
          covered.add(intent.slot);
          return { coveredMarketSlots: covered };
        }
        case 'ticketComplete': {
          const sweeps = [...s.sweeps, { id: nextId(), seat: intent.seat, path: intent.path }];
          if (intent.isYou) {
            const fanfare: Fanfare = {
              id: nextId(),
              ticketId: intent.ticketId,
              long: intent.long,
              seat: intent.seat,
            };
            return s.fanfare === null
              ? { sweeps, fanfare }
              : { sweeps, fanfareQueue: [...s.fanfareQueue, fanfare] };
          }
          return {
            sweeps,
            ticketCues: [
              ...s.ticketCues,
              { id: nextId(), playerId: intent.playerId, ticketId: intent.ticketId, seat: intent.seat },
            ],
          };
        }
        default:
          return s;
      }
    }),

  clearGlowRoute: (id) =>
    set((s) => {
      if (!s.glowingRoutes.has(id)) return s;
      const m = new Map(s.glowingRoutes);
      m.delete(id);
      return { glowingRoutes: m };
    }),
  clearGlowStation: (id) =>
    set((s) => {
      if (!s.glowingStations.has(id)) return s;
      const m = new Map(s.glowingStations);
      m.delete(id);
      return { glowingStations: m };
    }),
  removeFlight: (id) => set((s) => ({ flights: s.flights.filter((f) => f.id !== id) })),
  removeFloat: (id) => set((s) => ({ floats: s.floats.filter((f) => f.id !== id) })),
  removeSweep: (id) => set((s) => ({ sweeps: s.sweeps.filter((x) => x.id !== id) })),
  removeTicketCue: (id) => set((s) => ({ ticketCues: s.ticketCues.filter((c) => c.id !== id) })),
  clearTurnCue: (id) => set((s) => (s.turnCue?.id === id ? { turnCue: null } : s)),
  clearMarketFlip: (slot) =>
    set((s) => {
      if (!s.marketFlips.has(slot)) return s;
      const set2 = new Set(s.marketFlips);
      set2.delete(slot);
      return { marketFlips: set2 };
    }),
  revealMarketSlots: () =>
    set((s) => {
      if (s.coveredMarketSlots.size === 0) return s;
      const flips = new Set(s.marketFlips);
      for (const slot of s.coveredMarketSlots) flips.add(slot);
      return { coveredMarketSlots: new Set<number>(), marketFlips: flips };
    }),
  dismissFanfare: () =>
    set((s) => {
      const [next, ...rest] = s.fanfareQueue;
      return { fanfare: next ?? null, fanfareQueue: rest };
    }),
  reset: () => set(initial()),
}));
