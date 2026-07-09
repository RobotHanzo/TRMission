import { create } from 'zustand';
import { BOW_LIMIT } from '@trm/map-data';
import {
  api,
  type CityDraft,
  type MapDetail,
  type MapDraft,
  type MapRulesDraft,
  type RouteDraft,
  type TicketDraft,
} from '../../../net/rest';

export type Stage =
  | 'crop'
  | 'trim'
  | 'stops'
  | 'routes'
  | 'curves'
  | 'missions'
  | 'rules'
  | 'share';
export const STAGES: readonly Stage[] = [
  'crop',
  'trim',
  'stops',
  'routes',
  'curves',
  'missions',
  'rules',
  'share',
];

export type Selection =
  | { kind: 'city'; id: string }
  | { kind: 'route'; id: string }
  | { kind: 'ticket'; id: string }
  | null;

const emptyDraft = (): MapDraft => ({ cities: [], routes: [], tickets: [] });

let nextRouteCounter = 0;
/** Mints a unique route id for a newly authored route or double-pair sibling. */
export const newRouteId = (): string =>
  `r${Date.now().toString(36)}${(nextRouteCounter++).toString(36)}`;

const DOUBLE_GROUP_LETTERS = 'ABCDEFGHIJ';
/** First double-group letter (A-J) not already used by `existingGroups`; falls back to 'A' once
 *  all ten are taken (a builder-side limit, not enforced elsewhere). */
export function nextDoubleGroupLetter(existingGroups: readonly string[]): string {
  for (const letter of DOUBLE_GROUP_LETTERS) {
    if (!existingGroups.includes(letter)) return letter;
  }
  return 'A';
}

interface EditorState {
  mapId: string | null;
  loadState: 'idle' | 'loading' | 'ready' | 'error';
  nameZh: string;
  nameEn: string;
  draft: MapDraft;
  revision: number;
  shareCode: string | undefined;
  stage: Stage;
  selection: Selection;
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  undoStack: MapDraft[];
  redoStack: MapDraft[];

  load(mapId: string): Promise<void>;
  setStage(stage: Stage): void;
  select(selection: Selection): void;

  setName(nameZh: string, nameEn: string): void;
  placeCity(city: CityDraft): void;
  updateCity(id: string, patch: Partial<CityDraft>): void;
  removeCity(id: string): void;
  moveCity(id: string, x: number, y: number): void;

  addRoute(route: RouteDraft): void;
  updateRoute(id: string, patch: Partial<RouteDraft>): void;
  removeRoute(id: string): void;
  /** Normalize all routes on the target route's city pair into ONE parallel group of `count`
   *  tracks (1 = single/no group, 2 = double, 3 = triple). Mints or drops sibling routes as
   *  needed and re-groups them under a single letter; one undo step. */
  setPairTrackCount(id: string, count: 1 | 2 | 3): void;
  /** Set (clamped ±BOW_LIMIT, 0.1-rounded) or clear (undefined) a route's curvature override.
   *  A double pair's siblings are always patched together so the twin track bows as one. */
  setRouteBow(id: string, bow: number | undefined): void;
  clearAllRouteBows(): void;

  addTicket(ticket: TicketDraft): void;
  updateTicket(id: string, patch: Partial<TicketDraft>): void;
  removeTicket(id: string): void;
  replaceTickets(tickets: TicketDraft[]): void;

  setGeography(geography: NonNullable<MapDraft['geography']>): void;
  removeGeographyRings(indices: readonly number[]): void;
  setRules(rules: MapRulesDraft): void;

  undo(): void;
  redo(): void;
  save(): Promise<void>;
  mintShare(): Promise<string>;
  revokeShare(): Promise<void>;
}

const UNDO_CAP = 50;

function mutate(
  get: () => EditorState,
  set: (p: Partial<EditorState>) => void,
  next: MapDraft,
): void {
  const stack = [...get().undoStack, get().draft].slice(-UNDO_CAP);
  // A fresh edit abandons whatever redo branch was pending — redoing past it would resurrect a
  // draft that no longer follows from the current one.
  set({ draft: next, dirty: true, undoStack: stack, redoStack: [] });
}

export const useEditorStore = create<EditorState>()((set, get) => ({
  mapId: null,
  loadState: 'idle',
  nameZh: '',
  nameEn: '',
  draft: emptyDraft(),
  revision: 0,
  shareCode: undefined,
  stage: 'crop',
  selection: null,
  dirty: false,
  saving: false,
  saveError: null,
  undoStack: [],
  redoStack: [],

  load: async (mapId) => {
    set({ mapId, loadState: 'loading', selection: null, undoStack: [], redoStack: [] });
    try {
      const detail: MapDetail = await api.getMap(mapId);
      set({
        loadState: 'ready',
        nameZh: detail.nameZh,
        nameEn: detail.nameEn,
        draft: detail.draft,
        revision: detail.revision,
        shareCode: detail.shareCode,
        dirty: false,
        stage: detail.draft.geography ? 'stops' : 'crop',
      });
    } catch {
      set({ loadState: 'error' });
    }
  },

  setStage: (stage) => set({ stage }),
  select: (selection) => set({ selection }),

  setName: (nameZh, nameEn) => set({ nameZh, nameEn, dirty: true }),

  placeCity: (city) => {
    const { draft } = get();
    mutate(get, set, { ...draft, cities: [...draft.cities, city] });
  },
  updateCity: (id, patch) => {
    const { draft } = get();
    mutate(get, set, {
      ...draft,
      cities: draft.cities.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  },
  removeCity: (id) => {
    const { draft } = get();
    // Cascade: a deleted city can't remain an endpoint of any route or ticket.
    mutate(get, set, {
      ...draft,
      cities: draft.cities.filter((c) => c.id !== id),
      routes: draft.routes.filter((r) => r.a !== id && r.b !== id),
      tickets: draft.tickets.filter((t) => t.a !== id && t.b !== id),
    });
    if (get().selection?.kind === 'city' && get().selection?.id === id) set({ selection: null });
  },
  moveCity: (id, x, y) => {
    const { draft } = get();
    mutate(get, set, {
      ...draft,
      cities: draft.cities.map((c) => (c.id === id ? { ...c, x, y } : c)),
    });
  },

  addRoute: (route) => {
    const { draft } = get();
    mutate(get, set, { ...draft, routes: [...draft.routes, route] });
  },
  updateRoute: (id, patch) => {
    const { draft } = get();
    mutate(get, set, {
      ...draft,
      routes: draft.routes.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    });
  },
  removeRoute: (id) => {
    const { draft } = get();
    const target = draft.routes.find((r) => r.id === id);
    mutate(get, set, {
      ...draft,
      // Deleting one half of a double-route pair also frees its sibling's doubleGroup, since a
      // "double" with only one member is no longer meaningful (validateContent would reject it).
      routes: draft.routes
        .filter((r) => r.id !== id)
        .map((r) => {
          if (!target?.doubleGroup || r.doubleGroup !== target.doubleGroup) return r;
          const { doubleGroup: _drop, ...rest } = r;
          return rest;
        }),
    });
    if (get().selection?.kind === 'route' && get().selection?.id === id) set({ selection: null });
  },
  setPairTrackCount: (id, count) => {
    const { draft } = get();
    const target = draft.routes.find((r) => r.id === id);
    if (!target) return;
    const clamped = Math.max(1, Math.min(3, Math.round(count)));
    const onPair = (r: RouteDraft): boolean =>
      (r.a === target.a && r.b === target.b) || (r.a === target.b && r.b === target.a);
    // Target first, then the pair's other routes in draft order.
    const pairRoutes = [target, ...draft.routes.filter((r) => r.id !== target.id && onPair(r))];
    const others = draft.routes.filter((r) => !onPair(r));

    if (clamped === 1) {
      const { doubleGroup: _drop, ...survivor } = target;
      mutate(get, set, { ...draft, routes: [...others, survivor] });
      return;
    }

    // Reuse the pair's existing group letter if any; otherwise the next free one.
    const existingLetter = pairRoutes.map((r) => r.doubleGroup).find(Boolean);
    const group =
      existingLetter ??
      nextDoubleGroupLetter([
        ...new Set(draft.routes.map((r) => r.doubleGroup).filter(Boolean)),
      ] as string[]);
    // Minted siblings mirror the target (ferry stays GRAY; otherwise flip RED↔BLUE).
    const siblingColor =
      target.ferryLocos > 0 ? target.color : target.color === 'RED' ? 'BLUE' : 'RED';

    const grouped: RouteDraft[] = [];
    for (let i = 0; i < clamped; i++) {
      const existing = pairRoutes[i];
      if (existing) {
        grouped.push({ ...existing, length: target.length, doubleGroup: group });
      } else {
        grouped.push({
          ...target,
          id: newRouteId(),
          color: siblingColor,
          length: target.length,
          doubleGroup: group,
        });
      }
    }
    mutate(get, set, { ...draft, routes: [...others, ...grouped] });
  },
  setRouteBow: (id, bow) => {
    const { draft } = get();
    const target = draft.routes.find((r) => r.id === id);
    if (!target) return;
    // 0.1 granularity keeps drafts (and thus content hashes) stable across drag jitter;
    // `|| 0` normalises -0 away. bow: 0 is meaningful — it forces a straight route.
    const rounded =
      bow === undefined
        ? undefined
        : Math.round(Math.max(-BOW_LIMIT, Math.min(BOW_LIMIT, bow)) * 10) / 10 || 0;
    const inPair = (r: RouteDraft): boolean =>
      r.id === id || (!!target.doubleGroup && r.doubleGroup === target.doubleGroup);
    mutate(get, set, {
      ...draft,
      routes: draft.routes.map((r) => {
        if (!inPair(r)) return r;
        if (rounded === undefined) {
          const { bow: _drop, ...rest } = r;
          return rest;
        }
        return { ...r, bow: rounded };
      }),
    });
  },
  clearAllRouteBows: () => {
    const { draft } = get();
    if (!draft.routes.some((r) => r.bow !== undefined)) return;
    mutate(get, set, {
      ...draft,
      routes: draft.routes.map((r) => {
        if (r.bow === undefined) return r;
        const { bow: _drop, ...rest } = r;
        return rest;
      }),
    });
  },

  addTicket: (ticket) => {
    const { draft } = get();
    mutate(get, set, { ...draft, tickets: [...draft.tickets, ticket] });
  },
  updateTicket: (id, patch) => {
    const { draft } = get();
    mutate(get, set, {
      ...draft,
      tickets: draft.tickets.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    });
  },
  removeTicket: (id) => {
    const { draft } = get();
    mutate(get, set, { ...draft, tickets: draft.tickets.filter((t) => t.id !== id) });
  },
  replaceTickets: (tickets) => {
    const { draft } = get();
    mutate(get, set, { ...draft, tickets });
  },

  setGeography: (geography) => {
    const { draft } = get();
    mutate(get, set, { ...draft, geography });
  },
  removeGeographyRings: (indices) => {
    const { draft } = get();
    if (!draft.geography || indices.length === 0) return;
    const drop = new Set(indices);
    mutate(get, set, {
      ...draft,
      geography: { ...draft.geography, land: draft.geography.land.filter((_, i) => !drop.has(i)) },
    });
  },
  setRules: (rules) => {
    const { draft } = get();
    mutate(get, set, { ...draft, rules });
  },

  undo: () => {
    const { undoStack, redoStack, draft } = get();
    const prev = undoStack[undoStack.length - 1];
    if (!prev) return;
    set({
      draft: prev,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, draft].slice(-UNDO_CAP),
      dirty: true,
    });
  },
  redo: () => {
    const { undoStack, redoStack, draft } = get();
    const next = redoStack[redoStack.length - 1];
    if (!next) return;
    set({
      draft: next,
      redoStack: redoStack.slice(0, -1),
      undoStack: [...undoStack, draft].slice(-UNDO_CAP),
      dirty: true,
    });
  },

  save: async () => {
    const { mapId, nameZh, nameEn, draft } = get();
    if (!mapId) return;
    set({ saving: true, saveError: null });
    try {
      const detail = await api.updateMap(mapId, { nameZh, nameEn, draft });
      set({ saving: false, dirty: false, revision: detail.revision });
    } catch (e) {
      set({ saving: false, saveError: e instanceof Error ? e.message : 'save failed' });
    }
  },

  mintShare: async () => {
    const { mapId } = get();
    if (!mapId) throw new Error('no map loaded');
    const { shareCode } = await api.shareMap(mapId);
    set({ shareCode });
    return shareCode;
  },
  revokeShare: async () => {
    const { mapId } = get();
    if (!mapId) return;
    await api.unshareMap(mapId);
    set({ shareCode: undefined });
  },
}));
