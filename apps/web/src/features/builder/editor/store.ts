import { create } from 'zustand';
import { api, type CityDraft, type MapDetail, type MapDraft, type MapRulesDraft, type RouteDraft, type TicketDraft } from '../../../net/rest';

export type Stage = 'crop' | 'stops' | 'routes' | 'missions' | 'rules' | 'share';
export const STAGES: readonly Stage[] = ['crop', 'stops', 'routes', 'missions', 'rules', 'share'];

export type Selection =
  | { kind: 'city'; id: string }
  | { kind: 'route'; id: string }
  | { kind: 'ticket'; id: string }
  | null;

const emptyDraft = (): MapDraft => ({ cities: [], routes: [], tickets: [] });

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

  addTicket(ticket: TicketDraft): void;
  updateTicket(id: string, patch: Partial<TicketDraft>): void;
  removeTicket(id: string): void;
  replaceTickets(tickets: TicketDraft[]): void;

  setGeography(geography: NonNullable<MapDraft['geography']>): void;
  setRules(rules: MapRulesDraft): void;

  undo(): void;
  save(): Promise<void>;
  mintShare(): Promise<string>;
  revokeShare(): Promise<void>;
}

const UNDO_CAP = 50;

function mutate(get: () => EditorState, set: (p: Partial<EditorState>) => void, next: MapDraft): void {
  const stack = [...get().undoStack, get().draft].slice(-UNDO_CAP);
  set({ draft: next, dirty: true, undoStack: stack });
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

  load: async (mapId) => {
    set({ mapId, loadState: 'loading', selection: null, undoStack: [] });
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
  setRules: (rules) => {
    const { draft } = get();
    mutate(get, set, { ...draft, rules });
  },

  undo: () => {
    const { undoStack } = get();
    const prev = undoStack[undoStack.length - 1];
    if (!prev) return;
    set({ draft: prev, undoStack: undoStack.slice(0, -1), dirty: true });
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
