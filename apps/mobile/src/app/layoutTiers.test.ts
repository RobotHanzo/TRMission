import { stageTier } from '../screens/stageLayout';

describe('layout tiers at real device widths (spec §2: compact <700, two-pane 700–999, three-pane ≥1000)', () => {
  const cases: Array<[number, string, ReturnType<typeof stageTier>]> = [
    [360, 'small Android phone portrait', 'compact'],
    [390, 'iPhone portrait', 'compact'],
    [674, 'iPad Stage Manager narrow window', 'compact'],
    [744, 'iPad mini portrait', 'two-pane'],
    [834, 'iPad Air portrait', 'two-pane'],
    [980, 'Android tablet split-screen', 'two-pane'],
    [1024, 'iPad landscape / Stage Manager wide', 'three-pane'],
    [1194, 'iPad Pro 11" landscape', 'three-pane'],
    [1366, 'iPad Pro 13" landscape', 'three-pane'],
  ];
  it.each(cases)('%idp (%s) → %s', (width, _label, tier) => {
    expect(stageTier(width)).toBe(tier);
  });
});
