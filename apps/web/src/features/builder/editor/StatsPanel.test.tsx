import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../../../i18n';
import { StatsPanel } from './StatsPanel';
import { useEditorStore } from './store';
import type { CityDraft, RouteDraft, TicketDraft } from '../../../net/rest';

const cities: CityDraft[] = [
  { id: 'c1', nameZh: '甲', nameEn: 'A', x: 10, y: 10, region: 'r', isIsland: false },
  { id: 'c2', nameZh: '乙', nameEn: 'B', x: 20, y: 20, region: 'r', isIsland: false },
  { id: 'c3', nameZh: '丙', nameEn: 'C', x: 30, y: 30, region: 'r', isIsland: false },
];

// Segments per colour: RED = 2+3+2 = 7, BLUE = 4+2 = 6, GRAY = 1 (ferry). Total = 14.
const routes: RouteDraft[] = [
  { id: 'r1', a: 'c1', b: 'c2', color: 'RED', length: 2, ferryLocos: 0, isTunnel: false },
  { id: 'r2', a: 'c2', b: 'c3', color: 'RED', length: 3, ferryLocos: 0, isTunnel: false },
  { id: 'r3', a: 'c1', b: 'c3', color: 'BLUE', length: 4, ferryLocos: 0, isTunnel: false },
  { id: 'r4', a: 'c1', b: 'c2', color: 'GRAY', length: 1, ferryLocos: 1, isTunnel: false },
  {
    id: 'r5',
    a: 'c2',
    b: 'c3',
    color: 'RED',
    length: 2,
    ferryLocos: 0,
    isTunnel: false,
    doubleGroup: 'A',
  },
  {
    id: 'r6',
    a: 'c2',
    b: 'c3',
    color: 'BLUE',
    length: 2,
    ferryLocos: 0,
    isTunnel: false,
    doubleGroup: 'A',
  },
];

const tickets: TicketDraft[] = [
  { id: 't1', a: 'c1', b: 'c2', value: 3, deck: 'SHORT' },
  { id: 't2', a: 'c1', b: 'c3', value: 4, deck: 'SHORT' },
  { id: 't3', a: 'c2', b: 'c3', value: 10, deck: 'LONG' },
];

beforeEach(() => {
  useEditorStore.setState({
    draft: {
      cities: cities.map((c) => ({ ...c })),
      routes: routes.map((r) => ({ ...r })),
      tickets: tickets.map((t) => ({ ...t })),
    },
  });
});

describe('StatsPanel', () => {
  it('shows station and route counts in the collapsed chip', () => {
    render(<StatsPanel />);
    const toggle = screen.getByRole('button', { name: '地圖統計' });
    expect(toggle.textContent).toContain('3'); // 3 stations
    expect(toggle.textContent).toContain('6'); // 6 routes
    // The breakdown stays hidden until expanded.
    expect(screen.queryByText('車廂總數')).not.toBeInTheDocument();
  });

  it('expands to the full breakdown with segment totals and the ticket split', () => {
    render(<StatsPanel />);
    fireEvent.click(screen.getByRole('button', { name: '地圖統計' }));

    const rowValue = (label: string): string | null =>
      screen.getByText(label).closest('.stats-row')?.textContent ?? null;
    expect(rowValue('車站')).toContain('3');
    expect(rowValue('路線')).toContain('6');
    expect(rowValue('車廂總數')).toContain('14');
    expect(rowValue('短途任務')).toContain('2');
    expect(rowValue('長途任務')).toContain('1');
  });

  it('breaks segments down by colour, summing route lengths and omitting unused colours', () => {
    render(<StatsPanel />);
    fireEvent.click(screen.getByRole('button', { name: '地圖統計' }));

    // Sum of lengths per colour (both halves of the double pair count).
    expect(screen.getByTitle('紅: 7')).toBeInTheDocument();
    expect(screen.getByTitle('藍: 6')).toBeInTheDocument();
    expect(screen.getByTitle('灰: 1')).toBeInTheDocument();
    // Colours with no routes never appear.
    expect(screen.queryByTitle(/^綠:/)).not.toBeInTheDocument();
  });
});
