import { describe, it, expect } from 'vitest';
import { asCityId, asRouteId } from '@trm/shared';
import type { GameContent } from '@trm/map-data';
import { buildBoard, groupMembersOf, groupSizeOf, siblingOf } from '../src/board';

const c = (id: string, x = 0) => ({
  id: asCityId(id),
  nameZh: id,
  nameEn: id,
  x,
  y: 0,
  region: 't',
  isIsland: false,
});
const r = (id: string, a: string, b: string, doubleGroup?: string) => ({
  id: asRouteId(id),
  a: asCityId(a),
  b: asCityId(b),
  color: 'RED' as const,
  length: 1 as const,
  ferryLocos: 0,
  isTunnel: false,
  ...(doubleGroup ? { doubleGroup } : {}),
});
const content: GameContent = {
  meta: { mapId: 'm', version: 1, nameZh: 'm', nameEn: 'm' },
  cities: [c('a'), c('b', 10)],
  routes: [
    r('D1', 'a', 'b', 'A'),
    r('D2', 'a', 'b', 'A'),
    r('T1', 'a', 'b', 'B'),
    r('T2', 'a', 'b', 'B'),
    r('T3', 'a', 'b', 'B'),
    r('S1', 'a', 'b'),
  ],
  tickets: [],
};

describe('board parallel groups', () => {
  const board = buildBoard(content);

  it('links the two members of a double group', () => {
    expect([...groupMembersOf(board, asRouteId('D1'))]).toEqual([asRouteId('D2')]);
    expect(groupSizeOf(board, asRouteId('D1'))).toBe(2);
    expect(siblingOf(board, asRouteId('D1'))).toBe(asRouteId('D2'));
  });

  it('links all other members of a triple group', () => {
    expect([...groupMembersOf(board, asRouteId('T2'))].sort()).toEqual(
      [asRouteId('T1'), asRouteId('T3')].sort(),
    );
    expect(groupSizeOf(board, asRouteId('T1'))).toBe(3);
  });

  it('treats a lone route as a size-1 group with no members', () => {
    expect(groupMembersOf(board, asRouteId('S1'))).toEqual([]);
    expect(groupSizeOf(board, asRouteId('S1'))).toBe(1);
  });
});
