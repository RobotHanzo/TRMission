import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../../../../i18n';
import { CurvesStage } from './CurvesStage';
import { useEditorStore } from '../store';
import type { RouteDraft } from '../../../../net/rest';

const routes: RouteDraft[] = [
  { id: 'r1', a: 'c1', b: 'c2', color: 'RED', length: 2, ferryLocos: 0, isTunnel: false },
  { id: 'r2', a: 'c2', b: 'c3', color: 'BLUE', length: 2, ferryLocos: 0, isTunnel: false, bow: 4 },
];

beforeEach(() => {
  useEditorStore.setState({
    mapId: 'm1',
    loadState: 'ready',
    nameZh: '',
    nameEn: '',
    draft: {
      cities: [
        { id: 'c1', nameZh: '甲', nameEn: 'A', x: 10, y: 50, region: 'r', isIsland: false },
        { id: 'c2', nameZh: '乙', nameEn: 'B', x: 60, y: 50, region: 'r', isIsland: false },
        { id: 'c3', nameZh: '丙', nameEn: 'C', x: 90, y: 20, region: 'r', isIsland: false },
      ],
      routes,
      tickets: [],
      geography: {
        baseView: { x: 0, y: 0, w: 100, h: 100 },
        land: [
          [
            [0, 0],
            [100, 0],
            [100, 100],
          ],
        ],
        crop: { lonMin: 0, lonMax: 1, latMin: 0, latMax: 1 },
      },
    },
    revision: 0,
    shareCode: undefined,
    stage: 'curves',
    selection: null,
    dirty: false,
    saving: false,
    saveError: null,
    undoStack: [],
    redoStack: [],
  });
});

describe('CurvesStage', () => {
  it('shows the empty hint and the reset-all button when bows exist', () => {
    render(<CurvesStage />);
    expect(screen.getByText('點擊路線以調整其彎曲程度')).toBeInTheDocument();
    expect(screen.getByText('全部重設為自動（1 條）')).toBeInTheDocument();
  });

  it('selecting a route shows the tuner, the auto value, and the apex handle', () => {
    const { container } = render(<CurvesStage />);
    fireEvent.click(container.querySelectorAll('.editor-route')[0]!);

    expect(screen.getByText('調整曲線：甲 ↔ 乙')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeInTheDocument();
    expect(screen.getByText(/自動值：/)).toBeInTheDocument();
    expect(container.querySelector('.curve-handle')).not.toBeNull();
  });

  it('slider change previews without committing; blur commits to the store', () => {
    const { container } = render(<CurvesStage />);
    fireEvent.click(container.querySelectorAll('.editor-route')[0]!);
    const slider = screen.getByRole('slider');

    fireEvent.change(slider, { target: { value: '3' } });
    expect(useEditorStore.getState().draft.routes[0]!.bow).toBeUndefined();

    fireEvent.blur(slider);
    expect(useEditorStore.getState().draft.routes[0]!.bow).toBe(3);
  });

  it('reset-to-auto removes the stored bow', () => {
    const { container } = render(<CurvesStage />);
    fireEvent.click(container.querySelectorAll('.editor-route')[1]!);

    fireEvent.click(screen.getByText('重設為自動'));

    expect(useEditorStore.getState().draft.routes[1]!.bow).toBeUndefined();
  });

  it('reset-all clears every tuned bow', () => {
    render(<CurvesStage />);
    fireEvent.click(screen.getByText('全部重設為自動（1 條）'));
    expect(useEditorStore.getState().draft.routes.every((r) => r.bow === undefined)).toBe(true);
  });
});
