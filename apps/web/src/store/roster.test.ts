import { describe, it, expect, beforeEach } from 'vitest';
import { useRoster } from './roster';

const member = (userId: string, displayName: string) => ({
  userId,
  displayName,
  isGuest: false,
  seat: 0,
  ready: false,
});
const spectator = (userId: string, displayName: string) => ({
  userId,
  displayName,
  isGuest: true,
});

beforeEach(() => {
  useRoster.getState().clear();
});

describe('useRoster', () => {
  it('indexes members by userId', () => {
    useRoster.getState().setMembers([member('p1', 'Alice')]);
    expect(useRoster.getState().byId.p1?.displayName).toBe('Alice');
  });

  it('also indexes spectators, marked distinctly from seated members', () => {
    useRoster.getState().setMembers([member('p1', 'Alice')], [spectator('s1', 'Watcher')]);
    expect(useRoster.getState().byId.s1).toEqual({
      userId: 's1',
      displayName: 'Watcher',
      isGuest: true,
      isSpectator: true,
    });
    expect(useRoster.getState().byId.p1?.isSpectator).toBeUndefined();
  });

  it('clear empties the roster', () => {
    useRoster.getState().setMembers([member('p1', 'Alice')]);
    useRoster.getState().clear();
    expect(useRoster.getState().byId).toEqual({});
  });
});
