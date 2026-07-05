import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../../../../i18n';
import { CropDrawStage } from './CropDrawStage';
import { useEditorStore } from '../store';

// jsdom has no getScreenCTM/createSVGPoint, so clientToBoardPoint's real SVG screen-CTM math
// can't resolve a point in tests (see StopsStage.test.tsx for the same rationale, applied there
// via a EditorCanvas mock). Stub it with an identity mapping so pointer events exercise
// CropDrawStage's own drag logic instead of silently no-op'ing.
vi.mock('../canvasProjection', () => ({
  clientToBoardPoint: (_svg: unknown, clientX: number, clientY: number) => ({
    x: clientX,
    y: clientY,
  }),
}));

beforeEach(() => {
  useEditorStore.setState({
    mapId: 'm1',
    loadState: 'ready',
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
});

// toLonLat computes { lon: pt.x, lat: -pt.y }, and the mock above returns pt = { x: clientX, y:
// clientY } — so clientY must be negated to get the intended latitude.
function drawRect(svg: Element, lonLatFrom: [number, number], lonLatTo: [number, number]) {
  fireEvent.pointerDown(svg, { clientX: lonLatFrom[0], clientY: -lonLatFrom[1], button: 0 });
  fireEvent.pointerMove(svg, { clientX: lonLatTo[0], clientY: -lonLatTo[1] });
  fireEvent.pointerUp(svg);
}

describe('CropDrawStage', () => {
  it('shows the empty preview hint until a region is drawn', () => {
    render(<CropDrawStage />);
    expect(screen.getByText('拖曳選取一個區域以預覽')).toBeInTheDocument();
  });

  it('drawing a rectangle over Japan produces a non-empty preview', () => {
    const { container } = render(<CropDrawStage />);
    const svg = container.querySelector('svg.editor-world')!;
    drawRect(svg, [128, 30], [146, 46]);
    expect(screen.queryByText('拖曳選取一個區域以預覽')).toBeNull();
    expect(container.querySelectorAll('.editor-crop-preview-svg path').length).toBeGreaterThan(0);
  });

  it('confirm commits the geography and advances to the trim stage', () => {
    const { container } = render(<CropDrawStage />);
    const svg = container.querySelector('svg.editor-world')!;
    drawRect(svg, [128, 30], [146, 46]);
    fireEvent.click(screen.getByText('確認裁切並繼續'));
    expect(useEditorStore.getState().draft.geography).toBeDefined();
    expect(useEditorStore.getState().stage).toBe('trim');
  });

  it('redraw clears the current rectangle back to the empty hint', () => {
    const { container } = render(<CropDrawStage />);
    const svg = container.querySelector('svg.editor-world')!;
    drawRect(svg, [128, 30], [146, 46]);
    fireEvent.click(screen.getByText('重新框選'));
    expect(screen.getByText('拖曳選取一個區域以預覽')).toBeInTheDocument();
  });
});
