import { describe, it, expect } from 'vitest';
import { brokenExclusiveRails, type BrokenRailInfo, type OwnershipInfo } from '../src/game/view';

const repair = (over: Partial<BrokenRailInfo> = {}): BrokenRailInfo => ({
  repairedByPlayerId: 'p1',
  repairedBySeat: 0,
  exclusiveTurnEnds: 2,
  ...over,
});

describe('brokenExclusiveRails', () => {
  it('keeps a repaired rail whose exclusivity window is still open', () => {
    const out = brokenExclusiveRails(new Map([['r1', repair()]]), new Map());
    expect([...out.keys()]).toEqual(['r1']);
    // The repair record survives, so a surface can name who may claim it first.
    expect(out.get('r1')?.repairedBySeat).toBe(0);
  });

  it('drops a rail once the window has closed — it is open to everyone', () => {
    const out = brokenExclusiveRails(
      new Map([['r1', repair({ exclusiveTurnEnds: 0 })]]),
      new Map(),
    );
    expect(out.size).toBe(0);
  });

  it('drops a rail that has already been claimed (owned or locked)', () => {
    const broken = new Map([
      ['r1', repair()],
      ['r2', repair()],
      ['r3', repair()],
    ]);
    const owned = new Map<string, OwnershipInfo>([
      ['r1', { ownerSeat: 1 }],
      ['r2', { locked: true }],
    ]);
    expect([...brokenExclusiveRails(broken, owned).keys()]).toEqual(['r3']);
  });
});
