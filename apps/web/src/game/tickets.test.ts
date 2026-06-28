import { describe, it, expect } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, type GameSnapshot } from '@trm/proto';
import { ROUTES, TICKETS, routeById, ticketById } from './content';
import { pathForTicket, playerLiveTotal, completedByPlayer } from './tickets';

const ME = 'p0';

function snap(over: Partial<{ ownEverything: boolean; routePoints: number; completed: string[] }>): GameSnapshot {
  const ownership = over.ownEverything
    ? ROUTES.map((r) => ({
        routeId: r.id as string,
        cell: { case: 'ownerPlayerId' as const, value: ME },
      }))
    : [];
  return create(GameSnapshotSchema, {
    players: [{ id: ME, seat: 0, routePoints: over.routePoints ?? 0 }],
    ownership,
    completedTickets: (over.completed ?? []).map((ticketId) => ({ playerId: ME, ticketId })),
  });
}

const firstTicket = TICKETS[0]!;

describe('pathForTicket', () => {
  it('returns an ordered, owned route path joining the ticket endpoints', () => {
    const s = snap({ ownEverything: true });
    const path = pathForTicket(s, ME, firstTicket.id as string);
    expect(path.length).toBeGreaterThan(0);
    // Every id is a real route, and the path touches both endpoints.
    const cities = new Set<string>();
    for (const id of path) {
      const r = routeById.get(id)!;
      expect(r).toBeTruthy();
      cities.add(r.a as string);
      cities.add(r.b as string);
    }
    expect(cities.has(firstTicket.a as string)).toBe(true);
    expect(cities.has(firstTicket.b as string)).toBe(true);
  });

  it('returns [] when the player owns no connecting routes', () => {
    expect(pathForTicket(snap({}), ME, firstTicket.id as string)).toEqual([]);
  });
});

describe('playerLiveTotal', () => {
  it('adds completed ticket values to route points', () => {
    const value = ticketById.get(firstTicket.id as string)!.value;
    const s = snap({ routePoints: 12, completed: [firstTicket.id as string] });
    expect(playerLiveTotal(s, ME)).toBe(12 + value);
  });

  it('is just route points when nothing is completed', () => {
    expect(playerLiveTotal(snap({ routePoints: 7 }), ME)).toBe(7);
  });
});

describe('completedByPlayer', () => {
  it('groups completed ticket ids by player', () => {
    const m = completedByPlayer(snap({ completed: [firstTicket.id as string] }));
    expect(m.get(ME)?.has(firstTicket.id as string)).toBe(true);
  });
});
