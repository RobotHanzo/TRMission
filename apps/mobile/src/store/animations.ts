import { create, useStore, type StateCreator } from 'zustand';
import { createContext, useContext } from 'react';
import type { CardColor } from '@trm/shared';
import type { AnimIntent } from '../game/animationModel';
import type { BoardFrameTarget } from '../board/frameTarget';

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
/** A persistent route highlight (the longest-trail review from the final scoreboard). */
export interface RouteReveal {
  seat: number;
  path: string[];
}
/** The one-shot "final round has begun" warning popup. */
export interface EndgameCue {
  id: number;
  /** Turns left once the endgame triggered (≈ one last turn per player). */
  finalTurns: number;
  /** Whether the local player is the one who ran their trains down and triggered it. */
  triggeredByYou: boolean;
  /** true ⇒ the end sequence began because the table deadlocked (no routes claimable). */
  deadlock: boolean;
}
/** The prominent (skippable) banner shown when a random event STARTS. Carries the raw event `kind`;
 *  the banner component resolves the localized name/desc at render. */
export interface EventBannerCue {
  id: number;
  kind: string;
}
/** Distributes Omit over a union so each member keeps only its own fields, instead of collapsing
 *  to the union's common keys (the built-in Omit is not distributive). */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** A single transient notification chip. Three shapes: an event announcement or a claim bonus
 *  (each its own member — a single literal `variant` per member is what lets TypeScript narrow
 *  the union cleanly by discriminant, unlike a shared `'announced' | 'bonus'` field would) whose
 *  copy + city/route names resolve at render (so late roster/locale changes apply), or a plain
 *  system message whose text is already fully resolved by the caller. */
export type NotificationCue =
  | {
      id: number;
      variant: 'announced';
      kind: string;
      reason: string;
      points: number;
      cityId: string;
      routeId: string;
    }
  | {
      id: number;
      variant: 'bonus';
      kind: string;
      /** EVENT_BONUS reason ("HOTSPOT"|"REOPEN"|"STAMP"|"CHARTER"|"FREE_STATION"). */
      reason: string;
      points: number;
      cityId: string;
      routeId: string;
    }
  | {
      id: number;
      variant: 'error' | 'notice' | 'success';
      text: string;
    };

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
  /** The active final-round warning popup (null = none). */
  endgameCue: EndgameCue | null;
  /** The active random-event START banner (null = none). */
  eventBanner: EventBannerCue | null;
  /** Live notification chips (system messages + random-event announcements/bonuses); each
   *  self-expires. */
  notifications: NotificationCue[];
  /** Longest-trail route highlight shown while reviewing the final scoreboard (null = none). */
  routeReveal: RouteReveal | null;
  /** One-shot board camera target requested from the events panel (null = none pending). */
  eventSpotlight: BoardFrameTarget | null;
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
  showEndgameWarning(finalTurns: number, triggeredByYou: boolean, deadlock: boolean): void;
  dismissEndgameWarning(): void;
  showEventBanner(kind: string): void;
  dismissEventBanner(): void;
  pushNotification(cue: DistributiveOmit<NotificationCue, 'id'>): void;
  removeNotification(id: number): void;
  setRouteReveal(seat: number, path: string[]): void;
  clearRouteReveal(): void;
  setEventSpotlight(target: BoardFrameTarget): void;
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
  endgameCue: null as EndgameCue | null,
  eventBanner: null as EventBannerCue | null,
  notifications: [] as NotificationCue[],
  routeReveal: null as RouteReveal | null,
  eventSpotlight: null as BoardFrameTarget | null,
});

const creator: StateCreator<AnimState> = (set) => ({
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
          return {
            floats: [
              ...s.floats,
              { id: nextId(), playerId: intent.playerId, amount: intent.amount },
            ],
          };
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
              {
                id: nextId(),
                playerId: intent.playerId,
                ticketId: intent.ticketId,
                seat: intent.seat,
              },
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
  showEndgameWarning: (finalTurns, triggeredByYou, deadlock) =>
    set({ endgameCue: { id: nextId(), finalTurns, triggeredByYou, deadlock } }),
  dismissEndgameWarning: () => set({ endgameCue: null }),
  showEventBanner: (kind) => set({ eventBanner: { id: nextId(), kind } }),
  dismissEventBanner: () => set({ eventBanner: null }),
  pushNotification: (cue) =>
    set((s) => ({
      notifications: [...s.notifications, { id: nextId(), ...cue } as NotificationCue],
    })),
  removeNotification: (id) =>
    set((s) => ({ notifications: s.notifications.filter((c) => c.id !== id) })),
  setRouteReveal: (seat, path) => set({ routeReveal: { seat, path } }),
  clearRouteReveal: () => set({ routeReveal: null }),
  setEventSpotlight: (target) => set({ eventSpotlight: target }),
  reset: () => set(initial()),
});

/** The live game's animation store singleton. */
export const useAnimations = create<AnimState>()(creator);

/** Create an ISOLATED animation store instance (the in-game encyclopedia sandbox uses its own). */
export const createAnimationsStore = () => create<AnimState>()(creator);

export type AnimationsStoreApi = typeof useAnimations;
const AnimationsStoreContext = createContext<AnimationsStoreApi | null>(null);
export const AnimationsStoreProvider = AnimationsStoreContext.Provider;

/** Subscribe to the contextual animation store — isolated under a provider, else the live singleton. */
export function useAnimationsStore<T>(selector: (s: AnimState) => T): T {
  const store = useContext(AnimationsStoreContext) ?? useAnimations;
  return useStore(store, selector);
}
