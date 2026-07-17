import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../../../../i18n';
import { CityPickStage } from './CityPickStage';
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

describe('CityPickStage', () => {
  it('shows the empty preview hint with nothing selected', () => {
    render(<CityPickStage />);
    expect(screen.getByText('選擇至少一個縣市以預覽')).toBeInTheDocument();
  });

  it('clicking a city path on the map selects it and updates the preview', () => {
    const { container } = render(<CityPickStage />);
    const taipei = container.querySelector('[data-city-id="TW-TPE"]')!;
    fireEvent.click(taipei);
    expect(taipei).toHaveClass('editor-country--selected');
    expect(screen.getByText('已選取 1 個縣市')).toBeInTheDocument();
    expect(container.querySelectorAll('.editor-crop-preview-svg path').length).toBeGreaterThan(0);
  });

  it('a map click and the sidebar checkbox toggle the same selection', () => {
    const { container } = render(<CityPickStage />);
    const checkbox = screen.getByRole('checkbox', { name: /Taichung City/i });
    fireEvent.click(checkbox);
    const path = container.querySelector('[data-city-id="TW-TXG"]')!;
    expect(path).toHaveClass('editor-country--selected');

    fireEvent.click(path);
    expect(checkbox).not.toBeChecked();
  });

  it('renders the internal-border overlay only after enabling it for a multi-city pick', () => {
    const { container } = render(<CityPickStage />);
    fireEvent.click(container.querySelector('[data-city-id="TW-TPE"]')!);
    fireEvent.click(container.querySelector('[data-city-id="TW-TPQ"]')!);
    expect(container.querySelectorAll('.editor-crop-preview-svg .editor-world-border').length).toBe(
      0,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: '顯示縣市界線' }));
    expect(
      container.querySelectorAll('.editor-crop-preview-svg .editor-world-border').length,
    ).toBeGreaterThan(0);
  });

  it('confirm commits the combined geography and advances to the trim stage', () => {
    const { container } = render(<CityPickStage />);
    fireEvent.click(container.querySelector('[data-city-id="TW-TPE"]')!);
    fireEvent.click(screen.getByText('確認裁切並繼續'));
    expect(useEditorStore.getState().draft.geography).toBeDefined();
    expect(useEditorStore.getState().stage).toBe('trim');
  });
});
