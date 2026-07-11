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

  it('renders the world land as a three-copy panorama', () => {
    const { container } = render(<CropDrawStage />);
    // Same land ring set drawn at -360 / 0 / +360; land path count is a multiple of 3.
    const landPaths = container.querySelectorAll('svg.editor-world path.editor-world-land');
    expect(landPaths.length).toBeGreaterThan(0);
    expect(landPaths.length % 3).toBe(0);
  });

  it('draws a crop straddling the antimeridian and preserves the wrapping bounds', () => {
    const { container } = render(<CropDrawStage />);
    const svg = container.querySelector('svg.editor-world')!;
    // 160°E..200°E across the seam, high-latitude Bering band.
    drawRect(svg, [160, 50], [200, 72]);
    expect(container.querySelectorAll('.editor-crop-preview-svg path').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('確認裁切並繼續'));
    const crop = useEditorStore.getState().draft.geography!.crop;
    expect(crop.lonMin).toBe(160);
    expect(crop.lonMax).toBe(200); // wrapping crop preserved (lonMax > 180)
  });

  it('canonicalizes a crop drawn entirely in the wrap-around copy', () => {
    const { container } = render(<CropDrawStage />);
    const svg = container.querySelector('svg.editor-world')!;
    // Drawn at 190°..250° (the +360 wrap copy) — stored canonically as -170°..-110°, same width.
    drawRect(svg, [190, 50], [250, 72]);
    expect(container.querySelectorAll('.editor-crop-preview-svg path').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('確認裁切並繼續'));
    const crop = useEditorStore.getState().draft.geography!.crop;
    expect(crop.lonMin).toBe(-170);
    expect(crop.lonMax).toBe(-110);
  });
});
