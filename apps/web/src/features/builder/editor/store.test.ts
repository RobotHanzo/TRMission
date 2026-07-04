import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEditorStore } from './store';
import { api } from '../../../net/rest';
import type * as Rest from '../../../net/rest';
import type { CityDraft, MapGeographyDraft, RouteDraft, TicketDraft } from '../../../net/rest';

vi.mock('../../../net/rest', async () => {
  const actual = await vi.importActual<typeof Rest>('../../../net/rest');
  return {
    ...actual,
    api: {
      ...actual.api,
      getMap: vi.fn(),
      updateMap: vi.fn(),
      shareMap: vi.fn(),
      unshareMap: vi.fn(),
    },
  };
});

const city = (id: string, x = 0, y = 0): CityDraft => ({
  id,
  nameZh: id,
  nameEn: id,
  x,
  y,
  region: 'r',
  isIsland: false,
});
const route = (id: string, a: string, b: string, over: Partial<RouteDraft> = {}): RouteDraft => ({
  id,
  a,
  b,
  color: 'RED',
  length: 2,
  ferryLocos: 0,
  isTunnel: false,
  ...over,
});
const ticket = (id: string, a: string, b: string): TicketDraft => ({
  id,
  a,
  b,
  value: 2,
  deck: 'SHORT',
});
const ring = (...pts: [number, number][]) => pts;
const geography = (land: (readonly [number, number])[][]): MapGeographyDraft => ({
  baseView: { x: 0, y: 0, w: 100, h: 100 },
  land,
  crop: { lonMin: 0, lonMax: 1, latMin: 0, latMax: 1 },
});

describe('editor store', () => {
  beforeEach(() => {
    useEditorStore.setState({
      mapId: null,
      loadState: 'idle',
      nameZh: '',
      nameEn: '',
      draft: { cities: [], routes: [], tickets: [] },
      revision: 0,
      shareCode: undefined,
      stage: 'crop',
      selection: null,
      dirty: false,
      saving: false,
      saveError: null,
      undoStack: [],
      redoStack: [],
    });
    vi.clearAllMocks();
  });

  it('places a city and marks the draft dirty', () => {
    useEditorStore.getState().placeCity(city('c1'));
    expect(useEditorStore.getState().draft.cities).toHaveLength(1);
    expect(useEditorStore.getState().dirty).toBe(true);
  });

  it('cascades a city deletion to its incident routes and tickets', () => {
    const s = useEditorStore.getState();
    s.placeCity(city('c1'));
    s.placeCity(city('c2'));
    s.placeCity(city('c3'));
    s.addRoute(route('r1', 'c1', 'c2'));
    s.addRoute(route('r2', 'c2', 'c3'));
    s.addTicket(ticket('t1', 'c1', 'c3'));
    s.addTicket(ticket('t2', 'c2', 'c3'));

    s.removeCity('c2');

    const draft = useEditorStore.getState().draft;
    expect(draft.cities.map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(draft.routes).toEqual([]); // both routes touched c2
    expect(draft.tickets.map((t) => t.id)).toEqual(['t1']); // t2 touched c2
  });

  it('frees a double-route sibling when its pair partner is deleted', () => {
    const s = useEditorStore.getState();
    s.placeCity(city('c1'));
    s.placeCity(city('c2'));
    s.addRoute(route('r1', 'c1', 'c2', { doubleGroup: 'A' }));
    s.addRoute(route('r2', 'c1', 'c2', { doubleGroup: 'A' }));

    s.removeRoute('r1');

    const remaining = useEditorStore.getState().draft.routes;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe('r2');
    expect(remaining[0]!.doubleGroup).toBeUndefined();
  });

  it('clears the selection when the selected city/route is removed', () => {
    const s = useEditorStore.getState();
    s.placeCity(city('c1'));
    s.placeCity(city('c2'));
    s.addRoute(route('r1', 'c1', 'c2'));
    s.select({ kind: 'route', id: 'r1' });
    s.removeRoute('r1');
    expect(useEditorStore.getState().selection).toBeNull();
  });

  it('undo restores the previous draft snapshot', () => {
    const s = useEditorStore.getState();
    s.placeCity(city('c1'));
    s.placeCity(city('c2'));
    expect(useEditorStore.getState().draft.cities).toHaveLength(2);
    s.undo();
    expect(useEditorStore.getState().draft.cities).toHaveLength(1);
    s.undo();
    expect(useEditorStore.getState().draft.cities).toHaveLength(0);
  });

  it('redo replays an undone edit', () => {
    const s = useEditorStore.getState();
    s.placeCity(city('c1'));
    s.placeCity(city('c2'));
    s.undo();
    expect(useEditorStore.getState().draft.cities).toHaveLength(1);

    s.redo();
    expect(useEditorStore.getState().draft.cities).toHaveLength(2);
    s.redo();
    expect(useEditorStore.getState().draft.cities).toHaveLength(2); // nothing left to redo
  });

  it('a new edit clears the redo branch', () => {
    const s = useEditorStore.getState();
    s.placeCity(city('c1'));
    s.placeCity(city('c2'));
    s.undo();
    s.placeCity(city('c3'));
    expect(useEditorStore.getState().redoStack).toHaveLength(0);
    s.redo();
    expect(useEditorStore.getState().draft.cities.map((c) => c.id)).toEqual(['c1', 'c3']);
  });

  it('removeGeographyRings drops only the given land ring indices', () => {
    const s = useEditorStore.getState();
    const rings = [
      ring([0, 0], [1, 0], [1, 1]),
      ring([10, 10], [11, 10], [11, 11]),
      ring([20, 20], [21, 20], [21, 21]),
    ];
    s.setGeography(geography(rings));

    s.removeGeographyRings([0, 2]);

    const land = useEditorStore.getState().draft.geography?.land;
    expect(land).toEqual([rings[1]]);
  });

  it('removeGeographyRings is a no-op with no geography or no indices', () => {
    const s = useEditorStore.getState();
    s.removeGeographyRings([0]);
    expect(useEditorStore.getState().draft.geography).toBeUndefined();

    s.setGeography(geography([ring([0, 0], [1, 0], [1, 1])]));
    const before = useEditorStore.getState().undoStack.length;
    s.removeGeographyRings([]);
    expect(useEditorStore.getState().undoStack.length).toBe(before);
  });

  it('replaceTickets swaps the whole ticket deck at once (auto-generate apply)', () => {
    const s = useEditorStore.getState();
    s.addTicket(ticket('old', 'c1', 'c2'));
    s.replaceTickets([ticket('new1', 'c1', 'c2'), ticket('new2', 'c1', 'c3')]);
    expect(useEditorStore.getState().draft.tickets.map((t) => t.id)).toEqual(['new1', 'new2']);
  });

  it('save() calls updateMap with the current name+draft and clears dirty on success', async () => {
    (api.updateMap as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'm1',
      nameZh: 'X',
      nameEn: 'X',
      revision: 3,
      ownerId: 'u1',
      draft: { cities: [], routes: [], tickets: [] },
      updatedAt: '2026-01-01',
    });
    useEditorStore.setState({ mapId: 'm1', dirty: true });
    await useEditorStore.getState().save();
    expect(api.updateMap).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ nameZh: '', nameEn: '' }),
    );
    expect(useEditorStore.getState().dirty).toBe(false);
    expect(useEditorStore.getState().revision).toBe(3);
  });

  it('save() records an error and keeps dirty on failure', async () => {
    (api.updateMap as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('nope'));
    useEditorStore.setState({ mapId: 'm1', dirty: true });
    await useEditorStore.getState().save();
    expect(useEditorStore.getState().dirty).toBe(true);
    expect(useEditorStore.getState().saveError).toBe('nope');
  });

  describe('setRouteBow', () => {
    it('sets a 0.1-rounded, clamped bow on the route and marks dirty', () => {
      const s = useEditorStore.getState();
      s.placeCity(city('c1'));
      s.placeCity(city('c2', 10));
      s.addRoute(route('r1', 'c1', 'c2'));

      s.setRouteBow('r1', 3.14159);
      expect(useEditorStore.getState().draft.routes[0]!.bow).toBe(3.1);
      expect(useEditorStore.getState().dirty).toBe(true);

      s.setRouteBow('r1', 99);
      expect(useEditorStore.getState().draft.routes[0]!.bow).toBe(12);

      s.setRouteBow('r1', -0.04);
      expect(Object.is(useEditorStore.getState().draft.routes[0]!.bow, 0)).toBe(true);
    });

    it('applies the bow to both siblings of a double pair', () => {
      const s = useEditorStore.getState();
      s.placeCity(city('c1'));
      s.placeCity(city('c2', 10));
      s.addRoute(route('r1', 'c1', 'c2', { doubleGroup: 'A' }));
      s.addRoute(route('r2', 'c1', 'c2', { doubleGroup: 'A' }));
      s.addRoute(route('r3', 'c1', 'c2'));

      s.setRouteBow('r1', 2);

      const routes = useEditorStore.getState().draft.routes;
      expect(routes.find((r) => r.id === 'r1')!.bow).toBe(2);
      expect(routes.find((r) => r.id === 'r2')!.bow).toBe(2);
      expect(routes.find((r) => r.id === 'r3')!.bow).toBeUndefined();
    });

    it('undefined removes the key entirely (both siblings), as one undo entry', () => {
      const s = useEditorStore.getState();
      s.placeCity(city('c1'));
      s.placeCity(city('c2', 10));
      s.addRoute(route('r1', 'c1', 'c2', { doubleGroup: 'A' }));
      s.addRoute(route('r2', 'c1', 'c2', { doubleGroup: 'A' }));
      s.setRouteBow('r1', 2);

      s.setRouteBow('r2', undefined);

      for (const r of useEditorStore.getState().draft.routes) {
        expect(Object.keys(r)).not.toContain('bow');
      }
      s.undo();
      expect(useEditorStore.getState().draft.routes[0]!.bow).toBe(2);
    });

    it('is a no-op for an unknown route id', () => {
      const before = useEditorStore.getState().undoStack.length;
      useEditorStore.getState().setRouteBow('nope', 3);
      expect(useEditorStore.getState().undoStack.length).toBe(before);
    });
  });

  describe('clearAllRouteBows', () => {
    it('strips every bow in one undo step, and is a no-op when none are set', () => {
      const s = useEditorStore.getState();
      s.placeCity(city('c1'));
      s.placeCity(city('c2', 10));
      s.addRoute(route('r1', 'c1', 'c2'));
      s.addRoute(route('r2', 'c1', 'c2'));
      s.setRouteBow('r1', 1);
      s.setRouteBow('r2', -2);
      const undoBefore = useEditorStore.getState().undoStack.length;

      s.clearAllRouteBows();

      expect(useEditorStore.getState().draft.routes.every((r) => r.bow === undefined)).toBe(true);
      expect(useEditorStore.getState().undoStack.length).toBe(undoBefore + 1);

      s.clearAllRouteBows(); // nothing left to clear
      expect(useEditorStore.getState().undoStack.length).toBe(undoBefore + 1);
    });
  });
});
