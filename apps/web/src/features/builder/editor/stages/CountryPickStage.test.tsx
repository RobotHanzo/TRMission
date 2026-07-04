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
    // Canada (North America) + Russia (Europe/Asia border) — union bbox spans well over 120°
    // of longitude (Russia's own Natural Earth polygon already spans the full -180..180 due to
    // the antimeridian, so this also covers that pre-existing, accepted limitation).
    fireEvent.click(container.querySelector('[data-country-id="CAN"]')!);
    fireEvent.click(container.querySelector('[data-country-id="RUS"]')!);
    expect(screen.getByText('經度範圍過大，投影會失真')).toBeInTheDocument();
  });
});
