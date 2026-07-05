import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../../../../i18n';
import { CropStage } from './CropStage';
import { useEditorStore } from '../store';

// See CropDrawStage.test.tsx for why this stub is needed (jsdom has no getScreenCTM/createSVGPoint).
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

function drawRect(svg: Element, lonLatFrom: [number, number], lonLatTo: [number, number]) {
  fireEvent.pointerDown(svg, { clientX: lonLatFrom[0], clientY: -lonLatFrom[1], button: 0 });
  fireEvent.pointerMove(svg, { clientX: lonLatTo[0], clientY: -lonLatTo[1] });
  fireEvent.pointerUp(svg);
}

describe('CropStage', () => {
  it('defaults to draw mode (no country search box present)', () => {
    render(<CropStage />);
    expect(screen.queryByPlaceholderText('搜尋國家…')).toBeNull();
  });

  it('switches to country-pick mode via the toggle', () => {
    render(<CropStage />);
    fireEvent.click(screen.getByText('選擇國家'));
    expect(screen.getByPlaceholderText('搜尋國家…')).toBeInTheDocument();
  });

  it('discards an in-progress draw selection when switching away and back', () => {
    const { container } = render(<CropStage />);
    const svg = container.querySelector('svg.editor-world')!;
    drawRect(svg, [128, 30], [146, 46]);
    expect(screen.queryByText('拖曳選取一個區域以預覽')).toBeNull();

    fireEvent.click(screen.getByText('選擇國家'));
    fireEvent.click(screen.getByText('框選區域'));
    expect(screen.getByText('拖曳選取一個區域以預覽')).toBeInTheDocument();
  });

  it('discards an in-progress country selection when switching away and back', () => {
    const { container } = render(<CropStage />);
    fireEvent.click(screen.getByText('選擇國家'));
    fireEvent.click(container.querySelector('[data-country-id="JPN"]')!);
    expect(screen.queryByText('選擇至少一個國家以預覽')).toBeNull();

    fireEvent.click(screen.getByText('框選區域'));
    fireEvent.click(screen.getByText('選擇國家'));
    expect(screen.getByText('選擇至少一個國家以預覽')).toBeInTheDocument();
  });
});
