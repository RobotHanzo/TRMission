import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../../../../i18n';
import { CountryPickStage } from './CountryPickStage';
import { useEditorStore } from '../store';

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

describe('CountryPickStage', () => {
  it('shows the empty preview hint with nothing selected', () => {
    render(<CountryPickStage />);
    expect(screen.getByText('選擇至少一個國家以預覽')).toBeInTheDocument();
  });

  it('clicking a country path on the map selects it and updates the preview', () => {
    const { container } = render(<CountryPickStage />);
    const japan = container.querySelector('[data-country-id="JPN"]')!;
    fireEvent.click(japan);
    expect(japan).toHaveClass('editor-country--selected');
    expect(screen.getByText('已選取 1 個國家')).toBeInTheDocument();
    expect(container.querySelectorAll('.editor-crop-preview-svg path').length).toBeGreaterThan(0);
  });

  it('a map click and the sidebar checkbox toggle the same selection', () => {
    const { container } = render(<CountryPickStage />);
    const checkbox = screen.getByRole('checkbox', { name: /Japan/i });
    fireEvent.click(checkbox);
    const japanPath = container.querySelector('[data-country-id="JPN"]')!;
    expect(japanPath).toHaveClass('editor-country--selected');

    fireEvent.click(japanPath);
    expect(checkbox).not.toBeChecked();
  });

  it('confirm commits the combined geography and advances to the trim stage', () => {
    const { container } = render(<CountryPickStage />);
    fireEvent.click(container.querySelector('[data-country-id="JPN"]')!);
    fireEvent.click(screen.getByText('確認裁切並繼續'));
    expect(useEditorStore.getState().draft.geography).toBeDefined();
    expect(useEditorStore.getState().stage).toBe('trim');
  });

  it('warns when the combined selection spans an unreasonably wide longitude range', () => {
    const { container } = render(<CountryPickStage />);
    // Taiwan (~120-122°E) + Brazil (~-74 to -34°W) — neither country's own polygon spans
    // anywhere near 120° of longitude individually, so the ~156° union span genuinely comes
    // from combining two separate, far-apart countries (this is the same pairing the design
    // spec uses as its "distant selection" example).
    fireEvent.click(container.querySelector('[data-country-id="TWN"]')!);
    fireEvent.click(container.querySelector('[data-country-id="BRA"]')!);
    expect(screen.getByText('經度範圍過大，投影會失真')).toBeInTheDocument();
  });
});
