// The per-target gate check behind GameStage's pickRoute/pickCity wrappers: an `await` beat that
// names a route/city must accept ONLY that target; the wrong affordance kind (or a locked gate)
// accepts nothing; a live game (no gate) accepts everything.
import { gateAllowsTarget } from './actionGate';

describe('gateAllowsTarget', () => {
  it('no gate (live game) allows every target', () => {
    expect(gateAllowsTarget(null, 'route', 'R1')).toBe(true);
    expect(gateAllowsTarget(undefined, 'city', 'taipei')).toBe(true);
  });

  it('a locked gate allows nothing', () => {
    expect(gateAllowsTarget('locked', 'route', 'R1')).toBe(false);
    expect(gateAllowsTarget('locked', 'city', 'taipei')).toBe(false);
  });

  it('a CLAIM_ROUTE gate naming a route allows only that route', () => {
    const gate = { t: 'CLAIM_ROUTE', routeId: 'R42' } as const;
    expect(gateAllowsTarget(gate, 'route', 'R42')).toBe(true);
    expect(gateAllowsTarget(gate, 'route', 'R1')).toBe(false);
  });

  it('a CLAIM_ROUTE gate without a routeId allows any route but never a city', () => {
    const gate = { t: 'CLAIM_ROUTE' } as const;
    expect(gateAllowsTarget(gate, 'route', 'R1')).toBe(true);
    expect(gateAllowsTarget(gate, 'route', 'R42')).toBe(true);
    expect(gateAllowsTarget(gate, 'city', 'taipei')).toBe(false);
  });

  it('a BUILD_STATION gate naming a city allows only that city', () => {
    const gate = { t: 'BUILD_STATION', cityId: 'taipei' } as const;
    expect(gateAllowsTarget(gate, 'city', 'taipei')).toBe(true);
    expect(gateAllowsTarget(gate, 'city', 'banqiao')).toBe(false);
  });

  it('a BUILD_STATION gate without a cityId allows any city but never a route', () => {
    const gate = { t: 'BUILD_STATION' } as const;
    expect(gateAllowsTarget(gate, 'city', 'taipei')).toBe(true);
    expect(gateAllowsTarget(gate, 'route', 'R1')).toBe(false);
  });

  it('an unrelated await gate (draw / tickets / tunnel) allows no board target', () => {
    for (const t of ['DRAW_ANY', 'DRAW_BLIND', 'DRAW_FACEUP', 'DRAW_TICKETS', 'PASS'] as const) {
      expect(gateAllowsTarget({ t }, 'route', 'R1')).toBe(false);
      expect(gateAllowsTarget({ t }, 'city', 'taipei')).toBe(false);
    }
    expect(gateAllowsTarget({ t: 'RESOLVE_TUNNEL' }, 'route', 'R1')).toBe(false);
  });
});
