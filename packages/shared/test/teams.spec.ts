import { describe, it, expect } from 'vitest';
import { seatOrderMovingToTeam, shuffleSeatOrder, teamOfSeat } from '../src/teams';

const members = (n: number) =>
  Array.from({ length: n }, (_, seat) => ({ userId: `u${seat}`, seat }));

describe('seatOrderMovingToTeam', () => {
  it('swaps the mover with the target team’s lowest-seat occupant', () => {
    // 4 seats, 2 teams: team 0 = {u0, u2}, team 1 = {u1, u3}. Move u0 onto team 1.
    const order = seatOrderMovingToTeam(members(4), 'u0', 1, 2);
    expect(order).toEqual(['u1', 'u0', 'u2', 'u3']);
    // u0 is now on team 1, u1 lands on team 0 — exactly the two seats swapped.
    const seatOf = new Map(order!.map((id, seat) => [id, seat]));
    expect(teamOfSeat(seatOf.get('u0')!, 2)).toBe(1);
    expect(teamOfSeat(seatOf.get('u1')!, 2)).toBe(0);
  });

  it('is a no-op (null) when the mover is already on that team', () => {
    expect(seatOrderMovingToTeam(members(4), 'u0', 0, 2)).toBeNull();
  });

  it('returns null when no seat currently belongs to the target team', () => {
    // Only 2 members seated but teamCount is 3 — team 2 has no occupant yet.
    expect(seatOrderMovingToTeam(members(2), 'u0', 2, 3)).toBeNull();
  });

  it('returns null for an unknown userId', () => {
    expect(seatOrderMovingToTeam(members(4), 'ghost', 1, 2)).toBeNull();
  });

  it('leaves everyone else’s seat untouched', () => {
    const order = seatOrderMovingToTeam(members(6), 'u0', 1, 3);
    // team 1 = {u1, u4}; lowest seat is u1, so only u0/u1 swap.
    expect(order).toEqual(['u1', 'u0', 'u2', 'u3', 'u4', 'u5']);
  });
});

describe('shuffleSeatOrder', () => {
  it('returns a permutation of the input userIds', () => {
    const input = members(6);
    const order = shuffleSeatOrder(input);
    expect(order).toHaveLength(6);
    expect(new Set(order)).toEqual(new Set(input.map((m) => m.userId)));
  });

  it('handles trivial sizes without throwing', () => {
    expect(shuffleSeatOrder([])).toEqual([]);
    expect(shuffleSeatOrder([{ userId: 'solo' }])).toEqual(['solo']);
  });
});
