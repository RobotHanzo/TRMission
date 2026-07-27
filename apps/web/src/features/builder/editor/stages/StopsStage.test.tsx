import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '../../../../i18n';
import { StopsStage } from './StopsStage';
import { useEditorStore } from '../store';
import type { CityDraft } from '../../../../net/rest';

// EditorCanvas's real background/city clicks go through SVG screen-CTM math
// (clientToBoardPoint) that jsdom doesn't implement (no createSVGPoint), so a real <svg> click
// never reaches onBackgroundClick under Vitest. Stub it with plain buttons that call the same
// callbacks directly, so these tests exercise StopsStage's own move/place branching — the actual
// unit under test — instead of failing to fire at all. The stub also surfaces the selection it
// was handed and replays a drag gesture (begin → commit), the two things the real canvas does
// with the props this stage passes down.
const SHIFT = { shiftKey: true, ctrlKey: false, metaKey: false };
const PLAIN = { shiftKey: false, ctrlKey: false, metaKey: false };

vi.mock('../EditorCanvas', () => ({
  EditorCanvas: ({
    onBackgroundClick,
    onCityClick,
    selectedCities,
    cityDrag,
  }: {
    onBackgroundClick?: (point: { x: number; y: number }) => void;
    onCityClick?: (id: string, mods?: typeof PLAIN) => void;
    selectedCities?: ReadonlySet<string>;
    cityDrag?: {
      begin(id: string, mods: typeof PLAIN): ReadonlySet<string> | null;
      commit(ids: ReadonlySet<string>, dx: number, dy: number): void;
    };
  }) => (
    <div data-testid="fake-canvas" data-selected={[...(selectedCities ?? [])].sort().join(',')}>
      <button type="button" onClick={() => onBackgroundClick?.({ x: 42, y: 17 })}>
        background
      </button>
      {['c1', 'c2', 'c3'].map((id) => (
        <span key={id}>
          <button type="button" onClick={() => onCityClick?.(id, PLAIN)}>
            city-{id}
          </button>
          <button type="button" onClick={() => onCityClick?.(id, SHIFT)}>
            shift-city-{id}
          </button>
          <button
            type="button"
            onClick={() => {
              const ids = cityDrag?.begin(id, PLAIN);
              if (ids) cityDrag?.commit(ids, 5, -3);
            }}
          >
            drag-{id}
          </button>
        </span>
      ))}
    </div>
  ),
}));

const baseCities: CityDraft[] = [
  { id: 'c1', nameZh: '甲', nameEn: 'A', x: 10, y: 50, region: 'r', isIsland: false },
  { id: 'c2', nameZh: '乙', nameEn: 'B', x: 60, y: 50, region: 'r', isIsland: false },
  { id: 'c3', nameZh: '丙', nameEn: 'C', x: 30, y: 20, region: 'r', isIsland: false },
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
    expect(state.draft.cities).toHaveLength(3);
    expect(state.draft.cities.find((c) => c.id === 'c1')).toMatchObject({ x: 42, y: 17 });
    expect(state.selection).toEqual({ kind: 'city', id: 'c1' });
    expect(screen.getByText('移動車站')).toBeInTheDocument();
  });

  it('clicking the canvas without move mode still adds a new station as before', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('background'));

    const state = useEditorStore.getState();
    expect(state.draft.cities).toHaveLength(4);
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

  it('shows minor selected by default for a station with no tier set', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('city-c1'));

    const group = screen.getByRole('radiogroup', { name: '車站優先度' });
    expect(within(group).getByRole('radio', { name: '小站' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('selecting a priority updates the station tier', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('city-c1'));

    const group = screen.getByRole('radiogroup', { name: '車站優先度' });
    fireEvent.click(within(group).getByRole('radio', { name: '主要' }));

    const city = useEditorStore.getState().draft.cities.find((c) => c.id === 'c1');
    expect(city?.tier).toBe('major');
  });

  it('deleting the selected station exits move mode along with the inspector', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('city-c1'));
    fireEvent.click(screen.getByText('移動車站'));

    fireEvent.click(screen.getByText('刪除車站'));
    fireEvent.click(screen.getByText('確認刪除'));

    expect(useEditorStore.getState().draft.cities).toHaveLength(2);
    expect(screen.getByText('點擊地圖以新增車站，或點擊現有車站以編輯')).toBeInTheDocument();
  });

  it('shift-clicking adds a second station and swaps in the group panel', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('city-c1'));
    fireEvent.click(screen.getByText('shift-city-c2'));

    expect(screen.getByTestId('fake-canvas')).toHaveAttribute('data-selected', 'c1,c2');
    expect(screen.getByText('已選取 2 個車站')).toBeInTheDocument();
    expect(screen.getByText('一併移動選取的車站')).toBeInTheDocument();
    // The single-station editor is gone — a group has no one name to edit.
    expect(screen.queryByText('編輯車站')).not.toBeInTheDocument();
    // Store selection stays single-station only, so the other stages see what they always saw.
    expect(useEditorStore.getState().selection).toBeNull();
  });

  it('shift-clicking a selected station removes it from the selection', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('city-c1'));
    fireEvent.click(screen.getByText('shift-city-c2'));
    fireEvent.click(screen.getByText('shift-city-c1'));

    expect(screen.getByTestId('fake-canvas')).toHaveAttribute('data-selected', 'c2');
    expect(useEditorStore.getState().selection).toEqual({ kind: 'city', id: 'c2' });
  });

  it('select all picks every station; clear selection empties it', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('全選'));

    expect(screen.getByTestId('fake-canvas')).toHaveAttribute('data-selected', 'c1,c2,c3');
    expect(screen.getByText('已選取 3 個車站')).toBeInTheDocument();

    fireEvent.click(screen.getByText('清空選取'));
    expect(screen.getByTestId('fake-canvas')).toHaveAttribute('data-selected', '');
  });

  it('Ctrl+A selects every station, but not while a text field has focus', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('city-c1'));

    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'a', ctrlKey: true });
    expect(screen.getByTestId('fake-canvas')).toHaveAttribute('data-selected', 'c1');
    input.remove();

    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    expect(screen.getByTestId('fake-canvas')).toHaveAttribute('data-selected', 'c1,c2,c3');
  });

  it('moving a group lands its centre on the click and keeps the spacing', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('全選'));
    fireEvent.click(screen.getByText('一併移動選取的車站'));
    expect(screen.getByText('點擊地圖以放置這 3 個車站，彼此相對位置不變')).toBeInTheDocument();

    fireEvent.click(screen.getByText('background'));

    // Bounding-box centre of (10,50) (60,50) (30,20) is (35,35); the click was (42,17).
    const cities = useEditorStore.getState().draft.cities;
    expect(cities.find((c) => c.id === 'c1')).toMatchObject({ x: 17, y: 32 });
    expect(cities.find((c) => c.id === 'c2')).toMatchObject({ x: 67, y: 32 });
    expect(cities.find((c) => c.id === 'c3')).toMatchObject({ x: 37, y: 2 });
    // One undo step for the whole group.
    expect(useEditorStore.getState().undoStack).toHaveLength(1);
  });

  it('dragging a selected station moves the whole selection', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('city-c1'));
    fireEvent.click(screen.getByText('shift-city-c2'));

    fireEvent.click(screen.getByText('drag-c1'));

    const cities = useEditorStore.getState().draft.cities;
    expect(cities.find((c) => c.id === 'c1')).toMatchObject({ x: 15, y: 47 });
    expect(cities.find((c) => c.id === 'c2')).toMatchObject({ x: 65, y: 47 });
    expect(cities.find((c) => c.id === 'c3')).toMatchObject({ x: 30, y: 20 });
  });

  it('dragging a station outside the selection takes it as the new selection', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('city-c1'));

    fireEvent.click(screen.getByText('drag-c3'));

    expect(screen.getByTestId('fake-canvas')).toHaveAttribute('data-selected', 'c3');
    const cities = useEditorStore.getState().draft.cities;
    expect(cities.find((c) => c.id === 'c3')).toMatchObject({ x: 35, y: 17 });
    expect(cities.find((c) => c.id === 'c1')).toMatchObject({ x: 10, y: 50 });
  });

  it('arrow keys nudge the selection, Shift takes the bigger step', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('city-c1'));
    fireEvent.click(screen.getByText('shift-city-c2'));

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowUp', shiftKey: true });

    const cities = useEditorStore.getState().draft.cities;
    expect(cities.find((c) => c.id === 'c1')).toMatchObject({ x: 10.5, y: 48 });
    expect(cities.find((c) => c.id === 'c2')).toMatchObject({ x: 60.5, y: 48 });
  });

  it('multi-select mode toggles on plain clicks and stops the canvas adding stations', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByRole('switch', { name: '多選' }));

    fireEvent.click(screen.getByText('city-c1'));
    fireEvent.click(screen.getByText('city-c3'));
    expect(screen.getByTestId('fake-canvas')).toHaveAttribute('data-selected', 'c1,c3');

    fireEvent.click(screen.getByText('background'));
    expect(useEditorStore.getState().draft.cities).toHaveLength(3);
    expect(screen.getByTestId('fake-canvas')).toHaveAttribute('data-selected', '');
  });

  it('Escape clears the selection once there is no move to cancel', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('全選'));
    fireEvent.click(screen.getByText('一併移動選取的車站'));

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByText('一併移動選取的車站')).toBeInTheDocument();
    expect(screen.getByTestId('fake-canvas')).toHaveAttribute('data-selected', 'c1,c2,c3');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('fake-canvas')).toHaveAttribute('data-selected', '');
  });
});
