import { describe, it, expect } from 'vitest';
import type { RoomSettings } from '../src/net/restTypes';
import {
  HOUSE_RULES,
  SOLO_WAIT_RULE,
  activeHouseRules,
  roomSettingsGroups,
  teamLayoutFits,
  teamLayoutWarning,
} from '../src/game/roomSettingsMenu';

// The board is built from translated strings, so the tests translate keys to themselves (plus
// interpolated params) — what's asserted is which keys each group reaches for, and in what order.
const t = (key: string, params?: Record<string, string | number>): string =>
  params ? `${key}(${Object.values(params).join(',')})` : key;

const settings = (over: Partial<RoomSettings> = {}): RoomSettings => ({
  unlimitedStationBorrow: true,
  secondDrawAfterBlindRainbow: false,
  noUnfinishedTicketPenalty: false,
  doubleRouteSingleFor23: true,
  allowSpectating: true,
  visibility: 'INVITE_ONLY',
  map: { source: 'official', mapId: 'taiwan' },
  eventsMode: 'moderate',
  teamCount: 0,
  teamAssignMode: 'host',
  soloWaitForHost: true,
  ...over,
});

const groups = (
  over: Partial<RoomSettings> = {},
  input: Partial<Parameters<typeof roomSettingsGroups>[0]> = {},
) =>
  roomSettingsGroups(
    {
      settings: settings(over),
      mapName: 'Taiwan',
      showEvents: true,
      showSoloWait: false,
      seatedCount: 2,
      ...input,
    },
    t,
  );

describe('roomSettingsGroups', () => {
  it("states every group's current value, so the index answers without drilling in", () => {
    const board = groups();
    expect(board.map((g) => [g.id, g.value])).toEqual([
      ['map', 'Taiwan'],
      ['rules', 'ruleShortStationBorrow · ruleShortSingleParallel'],
      ['events', 'eventsMode_moderate'],
      ['teams', 'teamModeOff'],
      ['access', 'visibility_INVITE_ONLY · spectatingOn'],
    ]);
  });

  it('drops the events row when the picker is hidden, keeping the rest of the order', () => {
    expect(groups({}, { showEvents: false }).map((g) => g.id)).toEqual([
      'map',
      'rules',
      'teams',
      'access',
    ]);
  });

  it('names the team count and the assignment method together', () => {
    const teams = groups({ teamCount: 2, teamAssignMode: 'self' }, { seatedCount: 4 }).find(
      (g) => g.id === 'teams',
    );
    expect(teams?.value).toBe('teamMode2Teams · teamAssignModeSelf');
    expect(teams?.warning).toBeUndefined();
  });

  it('warns on the team row when the seated count cannot form that many teams', () => {
    const teams = groups({ teamCount: 3 }, { seatedCount: 4 }).find((g) => g.id === 'teams');
    expect(teams?.warning).toBe('teamNeedsPlayers(3,6,4)');
  });

  it('says so plainly when no house rule is in force', () => {
    const board = groups({
      unlimitedStationBorrow: false,
      doubleRouteSingleFor23: false,
    });
    expect(board.find((g) => g.id === 'rules')?.value).toBe('houseRulesAllOff');
  });

  it('folds the solo wait rule into the summary only while it applies', () => {
    expect(groups({}, { showSoloWait: false }).find((g) => g.id === 'rules')?.value).not.toContain(
      'ruleShortSoloWait',
    );
    expect(groups({}, { showSoloWait: true }).find((g) => g.id === 'rules')?.value).toContain(
      'ruleShortSoloWait',
    );
  });

  it('reflects spectating being closed', () => {
    expect(groups({ allowSpectating: false }).find((g) => g.id === 'access')?.value).toBe(
      'visibility_INVITE_ONLY · spectatingOff',
    );
  });
});

describe('house rule specs', () => {
  it('covers every boolean rule the room carries, each with its own three voices', () => {
    const all = [...HOUSE_RULES, SOLO_WAIT_RULE];
    expect(all.map((r) => r.key)).toEqual([
      'unlimitedStationBorrow',
      'secondDrawAfterBlindRainbow',
      'noUnfinishedTicketPenalty',
      'doubleRouteSingleFor23',
      'soloWaitForHost',
    ]);
    for (const rule of all) {
      expect(new Set([rule.labelKey, rule.descKey, rule.shortKey]).size).toBe(3);
    }
  });

  it('lists active rules in board order, not in the order they were switched on', () => {
    expect(
      activeHouseRules(settings({ secondDrawAfterBlindRainbow: true }), /* showSoloWait */ true, t),
    ).toEqual([
      'ruleShortStationBorrow',
      'ruleShortSecondDraw',
      'ruleShortSingleParallel',
      'ruleShortSoloWait',
    ]);
  });
});

describe('teamLayoutFits', () => {
  it('accepts free-for-all at any head-count', () => {
    expect(teamLayoutFits(0, 3)).toBe(true);
  });

  it('matches the authored layouts (4 or 6 players for pairs, 6 for trios)', () => {
    expect(teamLayoutFits(2, 4)).toBe(true);
    expect(teamLayoutFits(2, 6)).toBe(true);
    expect(teamLayoutFits(3, 6)).toBe(true);
    expect(teamLayoutFits(3, 5)).toBe(false);
  });

  it('has no warning to give while the line-up fits', () => {
    expect(teamLayoutWarning(2, 4, t)).toBeUndefined();
  });
});
