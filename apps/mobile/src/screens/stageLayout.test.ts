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
      'missions',
      'players',
      'log',
      'comms',
    ]);
    expect(dockTabs(true).map((t) => t.key)).toContain('events');
  });

  it('keeps the events tab between missions and players', () => {
    expect(dockTabs(true).map((t) => t.key)).toEqual([
      'hand',
      'missions',
      'events',
      'players',
      'log',
      'comms',
    ]);
  });

  it('has no draw tab — each deck lives with what it deals (issue #79)', () => {
    expect(dockTabs(true).map((t) => t.key)).not.toContain('draw');
  });

  it('keeps log and comms as separate tabs (log has no live-multiplayer requirement)', () => {
    const tabs = dockTabs(true);
    expect(tabs.find((t) => t.key === 'log')?.labelKey).toBe('log.heading');
    expect(tabs.find((t) => t.key === 'comms')?.labelKey).toBe('chat.heading');
  });

  it('carries count sources only on hand and missions', () => {
    const tabs = dockTabs(true);
    expect(tabs.find((t) => t.key === 'hand')?.countSource).toBe('hand');
    expect(tabs.find((t) => t.key === 'missions')?.countSource).toBe('missions');
    expect(tabs.find((t) => t.key === 'players')?.countSource).toBeNull();
  });
});
