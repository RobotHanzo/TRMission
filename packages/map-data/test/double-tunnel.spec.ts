import { describe, it, expect } from 'vitest';
import { asCityId, asRouteId } from '@trm/shared';
import type { RouteDef } from '../src/index';
import { validateContent } from '../src/index';
import { testContent, ringRoutes } from './fixtures';

describe('double-tunnel routes (custom maps)', () => {
  it('accepts a double-route pair where both members are tunnels', () => {
    const doubleTunnelPair: RouteDef[] = [
      {
        id: asRouteId('DT1'),
        a: asCityId('k0'),
        b: asCityId('k1'),
        color: 'RED',
        length: 2,
        ferryLocos: 0,
        isTunnel: true,
        doubleGroup: 'Z',
      },
      {
        id: asRouteId('DT2'),
        a: asCityId('k0'),
        b: asCityId('k1'),
        color: 'BLUE',
        length: 2,
        ferryLocos: 0,
        isTunnel: true,
        doubleGroup: 'Z',
      },
    ];
    const content = testContent({ routes: [...ringRoutes(12), ...doubleTunnelPair] });

    const result = validateContent(content);

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.stats.doublePairCount).toBe(1);
    expect(result.stats.tunnelCount).toBe(2);
  });

  it('accepts a mixed double-route pair (one tunnel, one plain colored route)', () => {
    const mixedPair: RouteDef[] = [
      {
        id: asRouteId('DT3'),
        a: asCityId('k0'),
        b: asCityId('k1'),
        color: 'PURPLE',
        length: 2,
        ferryLocos: 0,
        isTunnel: true,
        doubleGroup: 'Y',
      },
      {
        id: asRouteId('DT4'),
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
    expect(result.stats.tunnelCount).toBe(1);
  });

  it('accepts a GRAY-tunnel pair (documents that ferries and tunnels are independent flags)', () => {
    // R18 (臺北\u2013宜蘭) and R50 (日月潭\u2013花蓮) in the bundled map prove GRAY tunnels are a
    // valid authoring choice; the validator should treat `color=GRAY, ferryLocos=0, isTunnel=true`
    // as just another coloured tunnel rather than rejecting it as a mis-flagged ferry.
    const grayTunnelPair: RouteDef[] = [
      {
        id: asRouteId('GT1'),
        a: asCityId('k0'),
        b: asCityId('k1'),
        color: 'GRAY',
        length: 2,
        ferryLocos: 0,
        isTunnel: true,
        doubleGroup: 'W',
      },
      {
        id: asRouteId('GT2'),
        a: asCityId('k0'),
        b: asCityId('k1'),
        color: 'GRAY',
        length: 2,
        ferryLocos: 0,
        isTunnel: true,
        doubleGroup: 'W',
      },
    ];
    const content = testContent({ routes: [...ringRoutes(12), ...grayTunnelPair] });

    const result = validateContent(content);

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.stats.doublePairCount).toBe(1);
    expect(result.stats.tunnelCount).toBe(2);
    expect(result.stats.ferryCount).toBe(0);
  });
});
