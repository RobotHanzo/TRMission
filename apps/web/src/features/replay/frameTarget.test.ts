import { describe, it, expect } from 'vitest';
import { asPlayerId, asRouteId, asCityId } from '@trm/shared';
import type { Action, Payment } from '@trm/engine';
import { frameTargetForAction } from './frameTarget';

const player = asPlayerId('p1');
const payment: Payment = { color: 'RED', colorCount: 2, locomotives: 0 };

describe('frameTargetForAction', () => {
  it('maps CLAIM_ROUTE to a route frame target', () => {
    const action: Action = { t: 'CLAIM_ROUTE', player, routeId: asRouteId('r1'), payment };
    expect(frameTargetForAction(action, false)).toEqual({
      kind: 'route',
      ids: ['r1'],
      instant: false,
    });
  });

  it('maps BUILD_STATION to a cities frame target', () => {
    const action: Action = { t: 'BUILD_STATION', player, cityId: asCityId('taipei'), payment };
    expect(frameTargetForAction(action, true)).toEqual({
      kind: 'cities',
      ids: ['taipei'],
      instant: true,
    });
  });

  it('passes the instant flag through unchanged', () => {
    const action: Action = { t: 'CLAIM_ROUTE', player, routeId: asRouteId('r2'), payment };
    expect(frameTargetForAction(action, false)?.instant).toBe(false);
    expect(frameTargetForAction(action, true)?.instant).toBe(true);
  });

  it('returns null for non-spatial actions', () => {
    expect(frameTargetForAction({ t: 'PASS', player }, false)).toBeNull();
    expect(frameTargetForAction({ t: 'DRAW_BLIND', player }, false)).toBeNull();
    expect(frameTargetForAction({ t: 'DRAW_FACEUP', player, slot: 0 }, false)).toBeNull();
    expect(frameTargetForAction({ t: 'DRAW_TICKETS', player }, false)).toBeNull();
    expect(frameTargetForAction({ t: 'KEEP_TICKETS', player, keep: [] }, false)).toBeNull();
    expect(frameTargetForAction({ t: 'RESOLVE_TUNNEL', player, commit: true }, false)).toBeNull();
  });

  it('returns null when there is no action (step 0)', () => {
    expect(frameTargetForAction(null, false)).toBeNull();
  });
});
