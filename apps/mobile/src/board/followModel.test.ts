import { create } from '@bufbuild/protobuf';
import { GameEventSchema } from '@trm/proto';
import { latestActionPoi, shouldDisengageFollow } from './followModel';
import { ROUTE_GEOMETRY } from '../game/routeGeometry';
import { cityById } from '../game/content';

const routeId = [...ROUTE_GEOMETRY.keys()][0]!;
const otherRouteId = [...ROUTE_GEOMETRY.keys()][1]!;
const cityId = [...cityById.keys()][0]!;

describe('latestActionPoi', () => {
  it("returns the geometry midpoint of the acting player's newest claim, skipping others", () => {
    const events = [
      create(GameEventSchema, {
        event: { case: 'routeClaimed', value: { playerId: 'bot:1', routeId } },
      }),
      create(GameEventSchema, {
        event: { case: 'routeClaimed', value: { playerId: 'p2', routeId: otherRouteId } },
      }),
    ];
    const poi = latestActionPoi(events, 'bot:1');
    expect(poi?.key).toContain(routeId);
    expect(poi?.x).toBeCloseTo(ROUTE_GEOMETRY.get(routeId)!.mid.x);
    expect(poi?.y).toBeCloseTo(ROUTE_GEOMETRY.get(routeId)!.mid.y);
  });

  it('prefers the NEWEST of the acting player’s own spatial actions (tail-first scan)', () => {
    const events = [
      create(GameEventSchema, {
        event: { case: 'routeClaimed', value: { playerId: 'bot:1', routeId } },
      }),
      create(GameEventSchema, {
        event: { case: 'routeClaimed', value: { playerId: 'bot:1', routeId: otherRouteId } },
      }),
    ];
    const poi = latestActionPoi(events, 'bot:1');
    expect(poi?.key).toContain(otherRouteId);
  });

  it('resolves a stationBuilt event to the city position', () => {
    const events = [
      create(GameEventSchema, {
        event: { case: 'stationBuilt', value: { playerId: 'bot:2', cityId } },
      }),
    ];
    const poi = latestActionPoi(events, 'bot:2');
    const c = cityById.get(cityId)!;
    expect(poi).toMatchObject({ x: c.x, y: c.y });
    expect(poi?.key).toContain(cityId);
  });

  it('returns null when the player has no spatial action in the tail', () => {
    const events = [
      create(GameEventSchema, {
        event: { case: 'routeClaimed', value: { playerId: 'p2', routeId } },
      }),
    ];
    expect(latestActionPoi(events, 'bot:1')).toBeNull();
    expect(latestActionPoi([], 'bot:1')).toBeNull();
  });
});

describe('shouldDisengageFollow (ports Board.tsx disengageFollow)', () => {
  it('a gesture during MY turn keeps follow armed', () => {
    expect(shouldDisengageFollow(true, true)).toBe(false);
  });
  it('a gesture during another turn disengages', () => {
    expect(shouldDisengageFollow(true, false)).toBe(true);
  });
  it('no-op when follow is already off', () => {
    expect(shouldDisengageFollow(false, false)).toBe(false);
    expect(shouldDisengageFollow(false, true)).toBe(false);
  });
});
