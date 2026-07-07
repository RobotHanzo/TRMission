import { describe, it, expect } from 'vitest';
import { asCityId, asRouteId } from '@trm/shared';
import type { RouteDef } from '../src/index';
import { validateContent } from '../src/index';
import { testContent, ringRoutes } from './fixtures';

describe('double-ferry routes (custom maps)', () => {
  it('accepts a double-route pair where both members are ferries', () => {
    const doubleFerryPair: RouteDef[] = [
      {
        id: asRouteId('DF1'),
        a: asCityId('k0'),
        b: asCityId('k1'),
        color: 'GRAY',
        length: 2,
        ferryLocos: 1,
        isTunnel: false,
        doubleGroup: 'Z',
      },
      {
        id: asRouteId('DF2'),
        a: asCityId('k0'),
        b: asCityId('k1'),
        color: 'GRAY',
        length: 2,
        ferryLocos: 2,
        isTunnel: false,
        doubleGroup: 'Z',
      },
    ];
    const content = testContent({ routes: [...ringRoutes(12), ...doubleFerryPair] });

    const result = validateContent(content);

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.stats.doublePairCount).toBe(1);
    expect(result.stats.ferryCount).toBe(2);
  });

  it('accepts a mixed double-route pair (one ferry, one plain colored route)', () => {
    const mixedPair: RouteDef[] = [
      {
        id: asRouteId('DF3'),
        a: asCityId('k0'),
        b: asCityId('k1'),
        color: 'GRAY',
        length: 2,
        ferryLocos: 1,
        isTunnel: false,
        doubleGroup: 'Y',
      },
      {
        id: asRouteId('DF4'),
        a: asCityId('k0'),
        b: asCityId('k1'),
        color: 'RED',
        length: 2,
        ferryLocos: 0,
        isTunnel: false,
        doubleGroup: 'Y',
      },
    ];
    const content = testContent({ routes: [...ringRoutes(12), ...mixedPair] });

    const result = validateContent(content);

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.stats.doublePairCount).toBe(1);
    expect(result.stats.ferryCount).toBe(1);
  });
});
