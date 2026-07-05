import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../../../../i18n';
import { RoutesStage } from './RoutesStage';
import { useEditorStore } from '../store';
import type { CityDraft, RouteDraft } from '../../../../net/rest';

vi.mock('../EditorCanvas', () => ({
  EditorCanvas: ({
    onRouteClick,
  }: {
    onRouteClick?: (id: string) => void;
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

  it('hides the convert-to-double button for a tunnel route', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('route-r2'));

    expect(screen.queryByText('轉換為雙軌路線')).not.toBeInTheDocument();
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
});
