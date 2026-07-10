import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
      <button type="button" onClick={() => onRouteClick?.('r3')}>
        route-r3
      </button>
      <button type="button" onClick={() => onCityClick?.('c1')}>
        city-c1
      </button>
      <button type="button" onClick={() => onCityClick?.('c2')}>
        city-c2
      </button>
      <button type="button" onClick={() => onCityClick?.('c3')}>
        city-c3
      </button>
    </div>
  ),
}));

const baseCities: CityDraft[] = [
  { id: 'c1', nameZh: '甲', nameEn: 'A', x: 10, y: 50, region: 'r', isIsland: false },
  { id: 'c2', nameZh: '乙', nameEn: 'B', x: 60, y: 50, region: 'r', isIsland: false },
  { id: 'c3', nameZh: '丙', nameEn: 'C', x: 90, y: 50, region: 'r', isIsland: false },
];

// Two lone routes on distinct pairs (c1-c2 and c2-c3).
const baseRoutes: RouteDraft[] = [
  { id: 'r1', a: 'c1', b: 'c2', color: 'RED', length: 2, ferryLocos: 0, isTunnel: false },
  { id: 'r3', a: 'c2', b: 'c3', color: 'RED', length: 2, ferryLocos: 0, isTunnel: false },
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

const onPair = (a: string, b: string) => (r: RouteDraft) =>
  (r.a === a && r.b === b) || (r.a === b && r.b === a);

describe('RoutesStage', () => {
  it('shows the parallel-tracks control at 1 for a lone route', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('route-r1'));
    const group = screen.getByRole('radiogroup', { name: '平行軌道' });
    expect(within(group).getByRole('radio', { name: '1' })).toHaveAttribute('aria-checked', 'true');
  });

  it('clicking [2] turns a lone route into a clean double', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('route-r1'));
    const group = screen.getByRole('radiogroup', { name: '平行軌道' });
    fireEvent.click(within(group).getByRole('radio', { name: '2' }));

    const routes = useEditorStore.getState().draft.routes;
    const pair = routes.filter(onPair('c1', 'c2'));
    expect(pair).toHaveLength(2);
    expect(new Set(pair.map((r) => r.doubleGroup))).toEqual(new Set(['A']));
  });

  it('clicking [3] turns a lone route into a clean triple', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('route-r1'));
    const group = screen.getByRole('radiogroup', { name: '平行軌道' });
    fireEvent.click(within(group).getByRole('radio', { name: '3' }));

    const pair = useEditorStore.getState().draft.routes.filter(onPair('c1', 'c2'));
    expect(pair).toHaveLength(3);
    expect(new Set(pair.map((r) => r.doubleGroup)).size).toBe(1);
  });

  it('creates a double directly from the new-route form via the track selector', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('city-c1'));
    fireEvent.click(screen.getByText('city-c3')); // c1-c3 is a brand-new pair
    const group = screen.getByRole('radiogroup', { name: '平行軌道' });
    fireEvent.click(within(group).getByRole('radio', { name: '2' }));
    fireEvent.click(screen.getByText('儲存'));

    const created = useEditorStore.getState().draft.routes.filter(onPair('c1', 'c3'));
    expect(created).toHaveLength(2);
    expect(new Set(created.map((r) => r.doubleGroup)).size).toBe(1);
  });

  it('places the parallel-tracks control before the Save/Cancel row in the new-route form', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('city-c1'));
    fireEvent.click(screen.getByText('city-c3')); // c1-c3 is a brand-new pair
    const group = screen.getByRole('radiogroup', { name: '平行軌道' });
    const saveButton = screen.getByText('儲存');
    expect(
      group.compareDocumentPosition(saveButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('places the parallel-tracks control before the Save/Cancel row in the edit-route form', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('route-r1'));
    const group = screen.getByRole('radiogroup', { name: '平行軌道' });
    const saveButton = screen.getByText('儲存');
    expect(
      group.compareDocumentPosition(saveButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('selecting two cities that already have a route selects it instead of drawing a duplicate', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('city-c1'));
    fireEvent.click(screen.getByText('city-c2')); // r1 already connects c1-c2
    // The existing route is selected (edit form) and no duplicate route is drawn.
    expect(useEditorStore.getState().selection).toEqual({ kind: 'route', id: 'r1' });
    expect(useEditorStore.getState().draft.routes.filter(onPair('c1', 'c2'))).toHaveLength(1);
  });
});
