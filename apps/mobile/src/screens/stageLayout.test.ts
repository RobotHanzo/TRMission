import { stageTier, dockTabs } from './stageLayout';

describe('stageTier', () => {
  it('maps widths to the spec tiers', () => {
    expect(stageTier(360)).toBe('compact');
    expect(stageTier(699)).toBe('compact');
    expect(stageTier(700)).toBe('two-pane');
    expect(stageTier(999)).toBe('two-pane');
    expect(stageTier(1000)).toBe('three-pane');
  });
});

describe('dockTabs', () => {
  it('omits the events tab when the game has no random events', () => {
    expect(dockTabs(false).map((t) => t.key)).toEqual([
      'hand',
      'draw',
      'missions',
      'players',
      'comms',
    ]);
    expect(dockTabs(true).map((t) => t.key)).toContain('events');
  });

  it('keeps the events tab between missions and players (mirrors the web dock order)', () => {
    expect(dockTabs(true).map((t) => t.key)).toEqual([
      'hand',
      'draw',
      'missions',
      'events',
      'players',
      'comms',
    ]);
  });

  it('carries count sources only on hand and missions', () => {
    const tabs = dockTabs(true);
    expect(tabs.find((t) => t.key === 'hand')?.countSource).toBe('hand');
    expect(tabs.find((t) => t.key === 'missions')?.countSource).toBe('missions');
    expect(tabs.find((t) => t.key === 'draw')?.countSource).toBeNull();
  });
});
