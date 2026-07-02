import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../../../../i18n';
import { TrimStage } from './TrimStage';
import { useEditorStore } from '../store';

const ring = (...pts: [number, number][]) => pts;
const twoRings = [
  ring([10, 10], [20, 10], [20, 20], [10, 20]),
  ring([60, 60], [70, 60], [70, 70], [60, 70]),
];

beforeEach(() => {
  useEditorStore.setState({
    mapId: 'm1',
    loadState: 'ready',
    nameZh: '',
    nameEn: '',
    draft: {
      cities: [],
      routes: [],
      tickets: [],
      geography: {
        baseView: { x: 0, y: 0, w: 100, h: 100 },
        land: twoRings,
        crop: { lonMin: 0, lonMax: 1, latMin: 0, latMax: 1 },
      },
    },
    revision: 0,
    shareCode: undefined,
    stage: 'trim',
    selection: null,
    dirty: false,
    saving: false,
    saveError: null,
    undoStack: [],
    redoStack: [],
  });
});

describe('TrimStage', () => {
  it('shows the empty hint until a ring is selected', () => {
    render(<TrimStage />);
    expect(screen.getByText('點擊任一陸塊即可選取並刪除，例如不需要的外島')).toBeInTheDocument();
  });

  it('selects a land ring on click and shows the selected count', () => {
    const { container } = render(<TrimStage />);
    const rings = container.querySelectorAll('.land-ring');
    expect(rings).toHaveLength(2);

    fireEvent.click(rings[0]!);

    expect(rings[0]).toHaveClass('land-ring--selected');
    expect(screen.getByText('已選取 1 個區塊')).toBeInTheDocument();
  });

  it('deletes only the selected ring via the store, leaving the other intact', () => {
    const { container } = render(<TrimStage />);
    const rings = container.querySelectorAll('.land-ring');

    fireEvent.click(rings[0]!);
    fireEvent.click(screen.getByText('刪除選取區塊'));

    const land = useEditorStore.getState().draft.geography?.land;
    expect(land).toEqual([twoRings[1]]);
  });

  it('clicking empty space clears the selection', () => {
    const { container } = render(<TrimStage />);
    const svg = container.querySelector('svg.editor-trim')!;
    const rings = container.querySelectorAll('.land-ring');

    fireEvent.click(rings[0]!);
    expect(screen.getByText('已選取 1 個區塊')).toBeInTheDocument();

    fireEvent.click(svg);
    expect(screen.queryByText('已選取 1 個區塊')).toBeNull();
    expect(screen.getByText('點擊任一陸塊即可選取並刪除，例如不需要的外島')).toBeInTheDocument();
  });

  it('continue advances to the stops stage', () => {
    render(<TrimStage />);
    fireEvent.click(screen.getByText('繼續'));
    expect(useEditorStore.getState().stage).toBe('stops');
  });

  it('undo/redo buttons start disabled with no history', () => {
    render(<TrimStage />);
    expect(screen.getByRole('button', { name: '復原' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '重做' })).toBeDisabled();
  });

  it('the undo button restores a deleted ring and the redo button re-deletes it', () => {
    const { container } = render(<TrimStage />);
    const rings = container.querySelectorAll('.land-ring');
    fireEvent.click(rings[0]!);
    fireEvent.click(screen.getByText('刪除選取區塊'));
    expect(useEditorStore.getState().draft.geography?.land).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '復原' }));
    expect(useEditorStore.getState().draft.geography?.land).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(useEditorStore.getState().draft.geography?.land).toHaveLength(1);
  });

  it('Ctrl+Z and Ctrl+Y drive undo/redo while the stage is mounted', () => {
    const { container } = render(<TrimStage />);
    const rings = container.querySelectorAll('.land-ring');
    fireEvent.click(rings[0]!);
    fireEvent.click(screen.getByText('刪除選取區塊'));
    expect(useEditorStore.getState().draft.geography?.land).toHaveLength(1);

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(useEditorStore.getState().draft.geography?.land).toHaveLength(2);

    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    expect(useEditorStore.getState().draft.geography?.land).toHaveLength(1);
  });
});
