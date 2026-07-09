import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../../../../i18n';
import { RoutesStage } from './RoutesStage';
import { useEditorStore } from '../store';
import type { CityDraft, RouteDraft } from '../../../../net/rest';

vi.mock('../EditorCanvas', () => ({
  EditorCanvas: ({
    onRouteClick,
    onCityClick,
  }: {
    onRouteClick?: (id: string) => void;
    onCityClick?: (id: string) => void;
  }) => (
    <div data-testid="fake-canvas">
      <button type="button" onClick={() => onRouteClick?.('r1')}>
        route-r1
      </button>
      <button type="button" onClick={() => onRouteClick?.('r2')}>
        route-r2
      </button>
      <button type="button" onClick={() => onRouteClick?.('r3')}>
        route-r3
      </button>
      <button type="button" onClick={() => onRouteClick?.('r4')}>
        route-r4
      </button>
      <button type="button" onClick={() => onCityClick?.('c1')}>
        city-c1
      </button>
      <button type="button" onClick={() => onCityClick?.('c2')}>
        city-c2
      </button>
    </div>
  ),
}));

const baseCities: CityDraft[] = [
  { id: 'c1', nameZh: '甲', nameEn: 'A', x: 10, y: 50, region: 'r', isIsland: false },
  { id: 'c2', nameZh: '乙', nameEn: 'B', x: 60, y: 50, region: 'r', isIsland: false },
];

const baseRoutes: RouteDraft[] = [
  { id: 'r1', a: 'c1', b: 'c2', color: 'RED', length: 2, ferryLocos: 0, isTunnel: false },
  { id: 'r2', a: 'c1', b: 'c2', color: 'RED', length: 2, ferryLocos: 0, isTunnel: true },
  {
    id: 'r3',
    a: 'c1',
    b: 'c2',
    color: 'RED',
    length: 2,
    ferryLocos: 0,
    isTunnel: false,
    doubleGroup: 'A',
  },
  { id: 'r4', a: 'c1', b: 'c2', color: 'GRAY', length: 2, ferryLocos: 1, isTunnel: false },
];

beforeEach(() => {
  useEditorStore.setState({
    mapId: 'm1',
    loadState: 'ready',
    nameZh: '',
    nameEn: '',
    draft: {
      cities: baseCities.map((c) => ({ ...c })),
      routes: baseRoutes.map((r) => ({ ...r })),
      tickets: [],
    },
    revision: 0,
    shareCode: undefined,
    stage: 'routes',
    selection: null,
    dirty: false,
    saving: false,
    saveError: null,
    undoStack: [],
    redoStack: [],
  });
});

describe('RoutesStage', () => {
  it('shows the convert-to-double button for a plain single route', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('route-r1'));

    expect(screen.getByText('轉換為雙軌路線')).toBeInTheDocument();
  });

  it('hides the convert-to-double button for a route that is already part of a double pair', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('route-r3'));

    expect(screen.queryByText('轉換為雙軌路線')).not.toBeInTheDocument();
  });

  it('clicking convert-to-double turns the selected route into a double pair', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('route-r1'));
    fireEvent.click(screen.getByText('轉換為雙軌路線'));

    const routes = useEditorStore.getState().draft.routes;
    const original = routes.find((r) => r.id === 'r1')!;
    expect(original.doubleGroup).toBe('B'); // 'A' is already taken by r3
    const sibling = routes.find((r) => r.doubleGroup === 'B' && r.id !== 'r1');
    expect(sibling).toMatchObject({
      a: 'c1',
      b: 'c2',
      length: 2,
      isTunnel: false,
      ferryLocos: 0,
      color: 'BLUE',
    });
    expect(screen.queryByText('轉換為雙軌路線')).not.toBeInTheDocument();
  });

  it('shows the convert-to-double button for a ferry route', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('route-r4'));

    expect(screen.getByText('轉換為雙軌路線')).toBeInTheDocument();
  });

  it('clicking convert-to-double on a ferry route mirrors it into a double-ferry pair', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('route-r4'));
    fireEvent.click(screen.getByText('轉換為雙軌路線'));

    const routes = useEditorStore.getState().draft.routes;
    const original = routes.find((r) => r.id === 'r4')!;
    expect(original.doubleGroup).toBe('B'); // 'A' is already taken by r3
    const sibling = routes.find((r) => r.doubleGroup === 'B' && r.id !== 'r4');
    expect(sibling).toMatchObject({
      a: 'c1',
      b: 'c2',
      length: 2,
      isTunnel: false,
      ferryLocos: 1,
      color: 'GRAY',
    });
  });

  it('creates a mirrored double-ferry pair from the new-route form when ferry and make-double are both set', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('city-c1'));
    fireEvent.click(screen.getByText('city-c2'));

    fireEvent.change(screen.getByLabelText('渡輪所需彩色車頭數'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('switch', { name: '建立為雙軌路線' }));
    fireEvent.click(screen.getByText('儲存'));

    const routes = useEditorStore.getState().draft.routes;
    const created = routes.filter((r) => !baseRoutes.some((b) => b.id === r.id));
    expect(created).toHaveLength(2);
    const [first, second] = created;
    expect(first).toMatchObject({ a: 'c1', b: 'c2', color: 'GRAY', ferryLocos: 2 });
    expect(second).toMatchObject({
      a: 'c1',
      b: 'c2',
      color: 'GRAY',
      ferryLocos: 2,
      doubleGroup: first!.doubleGroup,
    });
  });

  it('shows the convert-to-double button for a tunnel route', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('route-r2'));

    expect(screen.getByText('轉換為雙軌路線')).toBeInTheDocument();
  });

  it('clicking convert-to-double on a tunnel route mirrors it into a double-tunnel pair', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('route-r2'));
    fireEvent.click(screen.getByText('轉換為雙軌路線'));

    const routes = useEditorStore.getState().draft.routes;
    const original = routes.find((r) => r.id === 'r2')!;
    expect(original.doubleGroup).toBe('B'); // 'A' is already taken by r3
    const sibling = routes.find((r) => r.doubleGroup === 'B' && r.id !== 'r2');
    expect(sibling).toMatchObject({
      a: 'c1',
      b: 'c2',
      length: 2,
      isTunnel: true,
      ferryLocos: 0,
      color: 'BLUE',
    });
  });

  it('creates a mirrored double-tunnel pair from the new-route form when tunnel and make-double are both set', () => {
    // This branch is the new-route path (RouteForm mounted with draftPair, `hideDouble` not
    // set), so the make-double Switch renders alongside the isTunnel Switch — both toggles are
    // user-driven, the test path is intentional rather than exploiting a defaults leak.
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('city-c1'));
    fireEvent.click(screen.getByText('city-c2'));

    fireEvent.click(screen.getByRole('switch', { name: '隧道' }));
    fireEvent.click(screen.getByRole('switch', { name: '建立為雙軌路線' }));
    fireEvent.click(screen.getByText('儲存'));

    const routes = useEditorStore.getState().draft.routes;
    const created = routes.filter((r) => !baseRoutes.some((b) => b.id === r.id));
    expect(created).toHaveLength(2);
    const [first, second] = created;
    expect(first).toMatchObject({ a: 'c1', b: 'c2', color: 'RED', isTunnel: true });
    expect(second).toMatchObject({
      a: 'c1',
      b: 'c2',
      color: 'BLUE',
      isTunnel: true,
      doubleGroup: first!.doubleGroup,
    });
  });
});
