import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import '../../../i18n';
import { EditorCanvas } from './EditorCanvas';
import { useEditorStore } from './store';
import type { CityDraft } from '../../../net/rest';

// jsdom has no getScreenCTM/createSVGPoint, so the real screen-CTM math can't resolve a point
// (same rationale as CropDrawStage.test.tsx). An identity mapping makes client pixels board units,
// so the drag gesture below exercises EditorCanvas's own logic rather than no-op'ing.
vi.mock('./canvasProjection', () => ({
  clientToBoardPoint: (_svg: unknown, clientX: number, clientY: number) => ({
    x: clientX,
    y: clientY,
  }),
}));

const cities: CityDraft[] = [
  { id: 'c1', nameZh: '甲', nameEn: 'A', x: 10, y: 50, region: 'r', isIsland: false },
  { id: 'c2', nameZh: '乙', nameEn: 'B', x: 60, y: 50, region: 'r', isIsland: false },
];

beforeEach(() => {
  useEditorStore.setState({
    mapId: 'm1',
    loadState: 'ready',
    nameZh: '',
    nameEn: '',
    draft: { cities: cities.map((c) => ({ ...c })), routes: [], tickets: [] },
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

const drag = (marker: Element, to: { x: number; y: number }) => {
  fireEvent.pointerDown(marker, { clientX: 10, clientY: 50, button: 0 });
  fireEvent.pointerMove(window, { clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(window);
};

describe('EditorCanvas station dragging', () => {
  it('commits the board-space translation for every city the gesture began with', () => {
    const commit = vi.fn();
    const ids = new Set(['c1', 'c2']);
    const { container } = render(
      <EditorCanvas selectedCities={ids} cityDrag={{ begin: () => ids, commit }} />,
    );

    drag(container.querySelector('[data-city-id="c1"]')!, { x: 30, y: 60 });

    expect(commit).toHaveBeenCalledWith(ids, 20, 10);
  });

  it('previews the whole selection at the dragged offset before the drop', () => {
    const ids = new Set(['c1', 'c2']);
    const { container } = render(
      <EditorCanvas selectedCities={ids} cityDrag={{ begin: () => ids, commit: vi.fn() }} />,
    );

    fireEvent.pointerDown(container.querySelector('[data-city-id="c1"]')!, {
      clientX: 10,
      clientY: 50,
      button: 0,
    });
    fireEvent.pointerMove(window, { clientX: 30, clientY: 60 });

    expect(container.querySelector('[data-city-id="c1"] .city-dot')).toHaveAttribute('cx', '30');
    expect(container.querySelector('[data-city-id="c2"] .city-dot')).toHaveAttribute('cx', '80');
    fireEvent.pointerUp(window);
  });

  it('leaves a press that never moves to the click handler', () => {
    const commit = vi.fn();
    const onCityClick = vi.fn();
    const { container } = render(
      <EditorCanvas
        selectedCities={new Set(['c1'])}
        cityDrag={{ begin: () => new Set(['c1']), commit }}
        onCityClick={onCityClick}
      />,
    );
    const marker = container.querySelector('[data-city-id="c1"]')!;

    fireEvent.pointerDown(marker, { clientX: 10, clientY: 50, button: 0 });
    fireEvent.pointerMove(window, { clientX: 11, clientY: 51 }); // inside the slop radius
    fireEvent.pointerUp(window);
    fireEvent.click(marker);

    expect(commit).not.toHaveBeenCalled();
    expect(onCityClick).toHaveBeenCalledWith('c1', expect.anything());
  });

  it('swallows the click a completed drag ends on, so no station is added', () => {
    const onBackgroundClick = vi.fn();
    const onCityClick = vi.fn();
    const { container } = render(
      <EditorCanvas
        selectedCities={new Set(['c1'])}
        cityDrag={{ begin: () => new Set(['c1']), commit: vi.fn() }}
        onBackgroundClick={onBackgroundClick}
        onCityClick={onCityClick}
      />,
    );

    drag(container.querySelector('[data-city-id="c1"]')!, { x: 30, y: 60 });
    // A drop over open water retargets the click to the svg root — the "add a station" path.
    fireEvent.click(container.querySelector('svg.editor-canvas')!);

    expect(onBackgroundClick).not.toHaveBeenCalled();
    expect(onCityClick).not.toHaveBeenCalled();
  });

  it('ignores a gesture the stage declines to start', () => {
    const commit = vi.fn();
    const { container } = render(
      <EditorCanvas selectedCities={new Set()} cityDrag={{ begin: () => null, commit }} />,
    );

    drag(container.querySelector('[data-city-id="c1"]')!, { x: 30, y: 60 });

    expect(commit).not.toHaveBeenCalled();
    expect(container.querySelector('[data-city-id="c1"] .city-dot')).toHaveAttribute('cx', '10');
  });
});

describe('EditorCanvas selection frame', () => {
  it('frames two or more selected stations and marks the centre they move around', () => {
    const { container } = render(<EditorCanvas selectedCities={new Set(['c1', 'c2'])} />);

    const rect = container.querySelector('.selection-frame rect')!;
    expect(rect.getAttribute('x')).toBe('8.2'); // 10 - 1.8 pad
    expect(rect.getAttribute('width')).toBe('53.6'); // 50 + 2 * 1.8
    // Crosshair on the bounding-box centre (35, 50) — where a "move selected" click lands.
    expect(container.querySelector('.selection-frame .selection-anchor')?.getAttribute('d')).toBe(
      'M33.9 50H36.1M35 48.9V51.1',
    );
  });

  it('draws no frame for a single station — its own ring already says it is picked', () => {
    const { container } = render(<EditorCanvas selectedCities={new Set(['c1'])} />);
    expect(container.querySelector('.selection-frame')).toBeNull();
  });

  it('marks every selected station selected on the map', () => {
    const { container } = render(<EditorCanvas selectedCities={new Set(['c1', 'c2'])} />);
    expect(container.querySelectorAll('.editor-city--selected')).toHaveLength(2);
  });
});
