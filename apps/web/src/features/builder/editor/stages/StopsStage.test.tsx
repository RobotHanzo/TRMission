import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../../../../i18n';
import { StopsStage } from './StopsStage';
import { useEditorStore } from '../store';
import type { CityDraft } from '../../../../net/rest';

// EditorCanvas's real background/city clicks go through SVG screen-CTM math
// (clientToBoardPoint) that jsdom doesn't implement (no createSVGPoint), so a real <svg> click
// never reaches onBackgroundClick under Vitest. Stub it with plain buttons that call the same
// callbacks directly, so these tests exercise StopsStage's own move/place branching — the actual
// unit under test — instead of failing to fire at all.
vi.mock('../EditorCanvas', () => ({
  EditorCanvas: ({
    onBackgroundClick,
    onCityClick,
  }: {
    onBackgroundClick?: (point: { x: number; y: number }) => void;
    onCityClick?: (id: string) => void;
  }) => (
    <div data-testid="fake-canvas">
      <button type="button" onClick={() => onBackgroundClick?.({ x: 42, y: 17 })}>
        background
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

beforeEach(() => {
  useEditorStore.setState({
    mapId: 'm1',
    loadState: 'ready',
    nameZh: '',
    nameEn: '',
    draft: { cities: baseCities.map((c) => ({ ...c })), routes: [], tickets: [] },
    revision: 0,
    shareCode: undefined,
    stage: 'stops',
    selection: null,
    dirty: false,
    saving: false,
    saveError: null,
    undoStack: [],
    redoStack: [],
  });
});

describe('StopsStage', () => {
  it('does not show the move button when no station is selected', () => {
    render(<StopsStage />);
    expect(screen.queryByText('移動車站')).not.toBeInTheDocument();
  });

  it('selecting a station shows the move button and the normal hint', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('city-c1'));

    expect(screen.getByText('移動車站')).toBeInTheDocument();
    expect(screen.getByText('點擊空白處新增車站，點擊車站以編輯')).toBeInTheDocument();
  });

  it('clicking move swaps the button label and the canvas hint', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('city-c1'));
    fireEvent.click(screen.getByText('移動車站'));

    expect(screen.getByText('取消移動')).toBeInTheDocument();
    expect(screen.getByText('點擊地圖以將「甲」移動到新位置')).toBeInTheDocument();
  });

  it('clicking the canvas in move mode moves the selected station instead of adding one', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('city-c1'));
    fireEvent.click(screen.getByText('移動車站'));

    fireEvent.click(screen.getByText('background'));

    const state = useEditorStore.getState();
    expect(state.draft.cities).toHaveLength(2);
    expect(state.draft.cities.find((c) => c.id === 'c1')).toMatchObject({ x: 42, y: 17 });
    expect(state.selection).toEqual({ kind: 'city', id: 'c1' });
    expect(screen.getByText('移動車站')).toBeInTheDocument();
  });

  it('clicking the canvas without move mode still adds a new station as before', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('background'));

    const state = useEditorStore.getState();
    expect(state.draft.cities).toHaveLength(3);
    expect(state.draft.cities.find((c) => c.id === 'c1')).toMatchObject({ x: 10, y: 50 });
  });

  it('Escape cancels move mode without changing the station position', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('city-c1'));
    fireEvent.click(screen.getByText('移動車站'));

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.getByText('移動車站')).toBeInTheDocument();
    expect(useEditorStore.getState().draft.cities.find((c) => c.id === 'c1')).toMatchObject({
      x: 10,
      y: 50,
    });
  });

  it('selecting a different station cancels move mode for the original one', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('city-c1'));
    fireEvent.click(screen.getByText('移動車站'));

    fireEvent.click(screen.getByText('city-c2'));

    expect(screen.getByText('移動車站')).toBeInTheDocument();
    expect(screen.queryByText('取消移動')).not.toBeInTheDocument();
  });

  it('deleting the selected station exits move mode along with the inspector', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('city-c1'));
    fireEvent.click(screen.getByText('移動車站'));

    fireEvent.click(screen.getByText('刪除車站'));
    fireEvent.click(screen.getByText('確認刪除'));

    expect(useEditorStore.getState().draft.cities).toHaveLength(1);
    expect(screen.getByText('點擊地圖以新增車站，或點擊現有車站以編輯')).toBeInTheDocument();
  });
});
