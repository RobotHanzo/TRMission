import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';
import { GameRegistry } from '../src/game/game-registry';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function guest(displayName: string): Promise<{ token: string; id: string }> {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

/** Host a room with `maxPlayers` seats, fill it with bots, and return the host + room code. */
async function roomWithBots(
  maxPlayers: number,
  bots: number,
): Promise<{ host: { token: string; id: string }; code: string }> {
  const host = await guest('Host');
  const room = await request(server())
    .post('/api/v1/rooms')
    .set(auth(host.token))
    .send({ maxPlayers })
    .expect(201);
  const code = room.body.code as string;
  for (let i = 0; i < bots; i++) {
    await request(server())
      .post(`/api/v1/rooms/${code}/bots`)
      .set(auth(host.token))
      .send({ difficulty: 'EASY' })
      .expect(200);
  }
  return { host, code };
}

const setTeams = (code: string, token: string, teamCount: number) =>
  request(server())
    .patch(`/api/v1/rooms/${code}/settings`)
    .set(auth(token))
    .send({ teamCount })
    .expect(200);

const ready = (code: string, token: string) =>
  request(server())
    .post(`/api/v1/rooms/${code}/ready`)
    .set(auth(token))
    .send({ ready: true })
    .expect(200);

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);
afterAll(() => t.close());

describe('lobby: team mode', () => {
  it('accepts a 6-seat room (seat 5 exists only for team layouts)', async () => {
    const { host, code } = await roomWithBots(6, 0);
    const room = await request(server())
      .get(`/api/v1/rooms/${code}`)
      .set(auth(host.token))
      .expect(200);
    expect(room.body.maxPlayers).toBe(6);
  });

  it('rejects more than 6 seats', async () => {
    const a = await guest('TooMany');
    await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({ maxPlayers: 7 })
      .expect(400);
  });

  it('starts a 4-player 2-team game and stamps teamCount on the engine state', async () => {
    const { host, code } = await roomWithBots(4, 3);
    await setTeams(code, host.token, 2);
    await ready(code, host.token);
    const started = await request(server())
      .post(`/api/v1/rooms/${code}/start`)
      .set(auth(host.token))
      .expect(200);

    const registry = t.app.get(GameRegistry);
    const state = registry.get(started.body.gameId)?.session.raw();
    expect(state?.teams).toHaveLength(2);
    // Membership is seat % teamCount, so the two rosters partition the table evenly.
    expect(state?.teams?.[0]).toHaveLength(2);
    expect(state?.teams?.[1]).toHaveLength(2);
    expect(state?.teamPools).toHaveLength(2);
    // Turn order alternates sides — no two consecutive players share a team.
    const teamOfPlayer = new Map<string, number>();
    state?.teams?.forEach((roster, team) =>
      roster.forEach((id) => teamOfPlayer.set(id as string, team)),
    );
    const order = (state?.turnOrder ?? []).map((id) => teamOfPlayer.get(id as string));
    for (let i = 0; i < order.length; i++) {
      expect(order[i]).not.toBe(order[(i + 1) % order.length]);
    }
  });

  it.each([
    [6, 3, 3],
    [6, 2, 2],
  ])('starts a 6-player table as %i players in %i teams', async (seats, teamCount, expected) => {
    const { host, code } = await roomWithBots(seats, seats - 1);
    await setTeams(code, host.token, teamCount);
    await ready(code, host.token);
    const started = await request(server())
      .post(`/api/v1/rooms/${code}/start`)
      .set(auth(host.token))
      .expect(200);
    const state = t.app.get(GameRegistry).get(started.body.gameId)?.session.raw();
    expect(state?.teams).toHaveLength(expected);
  });

  it('refuses to start when the team layout does not divide the table', async () => {
    // 5 seated players can be neither two pairs nor three pairs nor two trios.
    const { host, code } = await roomWithBots(5, 4);
    await setTeams(code, host.token, 2);
    await ready(code, host.token);
    const res = await request(server())
      .post(`/api/v1/rooms/${code}/start`)
      .set(auth(host.token))
      .expect(400);
    expect(String(res.body.message)).toMatch(/players/);
  });

  it('reseats the table to an explicit order and resets human ready flags', async () => {
    const { host, code } = await roomWithBots(4, 3);
    const before = await request(server())
      .get(`/api/v1/rooms/${code}`)
      .set(auth(host.token))
      .expect(200);
    const ids: string[] = before.body.members.map((m: { userId: string }) => m.userId);
    await ready(code, host.token);

    // Move the host from seat 0 to seat 1 — in a 2-team game that switches their side.
    const reordered = [ids[1], ids[0], ids[2], ids[3]];
    const after = await request(server())
      .post(`/api/v1/rooms/${code}/seats`)
      .set(auth(host.token))
      .send({ userIds: reordered })
      .expect(200);

    const seatOf = new Map<string, number>(
      after.body.members.map((m: { userId: string; seat: number }) => [m.userId, m.seat]),
    );
    expect(seatOf.get(ids[0] as string)).toBe(1);
    expect(seatOf.get(ids[1] as string)).toBe(0);
    // The host must re-confirm the new seating; bots stay ready.
    const hostRow = after.body.members.find((m: { userId: string }) => m.userId === host.id);
    expect(hostRow.ready).toBe(false);
    expect(
      after.body.members
        .filter((m: { isBot?: boolean }) => m.isBot)
        .every((m: { ready: boolean }) => m.ready),
    ).toBe(true);
  });

  it('rejects a seat order that is not a permutation of the current members', async () => {
    const { host, code } = await roomWithBots(4, 3);
    const room = await request(server())
      .get(`/api/v1/rooms/${code}`)
      .set(auth(host.token))
      .expect(200);
    const ids: string[] = room.body.members.map((m: { userId: string }) => m.userId);

    // Drops a player.
    await request(server())
      .post(`/api/v1/rooms/${code}/seats`)
      .set(auth(host.token))
      .send({ userIds: ids.slice(0, 3) })
      .expect(400);
    // Duplicates one.
    await request(server())
      .post(`/api/v1/rooms/${code}/seats`)
      .set(auth(host.token))
      .send({ userIds: [ids[0], ids[0], ids[2], ids[3]] })
      .expect(400);
  });

  it('lets only the host reseat', async () => {
    const { host, code } = await roomWithBots(4, 2);
    const other = await guest('Joiner');
    await request(server())
      .post(`/api/v1/rooms/${code}/join`)
      .set(auth(other.token))
      .send({})
      .expect(200);
    const room = await request(server())
      .get(`/api/v1/rooms/${code}`)
      .set(auth(host.token))
      .expect(200);
    const ids: string[] = room.body.members.map((m: { userId: string }) => m.userId);

    await request(server())
      .post(`/api/v1/rooms/${code}/seats`)
      .set(auth(other.token))
      .send({ userIds: [...ids].reverse() })
      .expect(403);
    expect(host.id).toBeDefined();
  });

  it('keeps a free-for-all room free of team state', async () => {
    const { host, code } = await roomWithBots(3, 2);
    await ready(code, host.token);
    const started = await request(server())
      .post(`/api/v1/rooms/${code}/start`)
      .set(auth(host.token))
      .expect(200);
    const state = t.app.get(GameRegistry).get(started.body.gameId)?.session.raw();
    expect(state?.teams).toBeUndefined();
    expect(state?.teamPools).toBeUndefined();
  });
});

describe('lobby: team assignment mode', () => {
  it('defaults to host-assign and persists a patch through settings', async () => {
    const { host, code } = await roomWithBots(4, 3);
    const before = await request(server())
      .get(`/api/v1/rooms/${code}`)
      .set(auth(host.token))
      .expect(200);
    expect(before.body.settings.teamAssignMode).toBe('host');

    const after = await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(host.token))
      .send({ teamAssignMode: 'self' })
      .expect(200);
    expect(after.body.settings.teamAssignMode).toBe('self');
  });

  it('lets a member self-join a team, swapping seats with the target team’s occupant', async () => {
    const host = await guest('Host');
    const other = await guest('Joiner');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(host.token))
      .send({ maxPlayers: 4 })
      .expect(201);
    const code = room.body.code as string;
    await request(server())
      .post(`/api/v1/rooms/${code}/join`)
      .set(auth(other.token))
      .send({})
      .expect(200);
    for (let i = 0; i < 2; i++) {
      await request(server())
        .post(`/api/v1/rooms/${code}/bots`)
        .set(auth(host.token))
        .send({ difficulty: 'EASY' })
        .expect(200);
    }
    await setTeams(code, host.token, 2);
    await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(host.token))
      .send({ teamAssignMode: 'self' })
      .expect(200);

    // host=seat0 (team0), other=seat1 (team1). `other` joins team 0, swapping with host.
    const after = await request(server())
      .post(`/api/v1/rooms/${code}/team`)
      .set(auth(other.token))
      .send({ team: 0 })
      .expect(200);
    const seatOf = new Map<string, number>(
      after.body.members.map((m: { userId: string; seat: number }) => [m.userId, m.seat]),
    );
    expect(seatOf.get(other.id)).toBe(0);
    expect(seatOf.get(host.id)).toBe(1);
    // Only the two swapped members' ready flags reset — bots are unaffected either way.
    const otherRow = after.body.members.find((m: { userId: string }) => m.userId === other.id);
    const hostRow = after.body.members.find((m: { userId: string }) => m.userId === host.id);
    expect(otherRow.ready).toBe(false);
    expect(hostRow.ready).toBe(false);
  });

  it('is a no-op (200, unchanged) when already on the requested team', async () => {
    const { host, code } = await roomWithBots(4, 3);
    await setTeams(code, host.token, 2);
    await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(host.token))
      .send({ teamAssignMode: 'self' })
      .expect(200);
    const before = await request(server())
      .get(`/api/v1/rooms/${code}`)
      .set(auth(host.token))
      .expect(200);
    const hostSeat = before.body.members.find((m: { userId: string }) => m.userId === host.id).seat;

    const after = await request(server())
      .post(`/api/v1/rooms/${code}/team`)
      .set(auth(host.token))
      .send({ team: hostSeat % 2 })
      .expect(200);
    expect(after.body.members.find((m: { userId: string }) => m.userId === host.id).seat).toBe(
      hostSeat,
    );
  });

  it('rejects self-join when the room is not in self mode', async () => {
    const { host, code } = await roomWithBots(4, 3);
    await setTeams(code, host.token, 2); // teamAssignMode defaults to 'host'
    await request(server())
      .post(`/api/v1/rooms/${code}/team`)
      .set(auth(host.token))
      .send({ team: 1 })
      .expect(403);
  });

  it('rejects an out-of-range team index', async () => {
    const { host, code } = await roomWithBots(4, 3);
    await setTeams(code, host.token, 2);
    await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(host.token))
      .send({ teamAssignMode: 'self' })
      .expect(200);
    await request(server())
      .post(`/api/v1/rooms/${code}/team`)
      .set(auth(host.token))
      .send({ team: 2 }) // only teams 0/1 exist for a 2-team room
      .expect(400);
  });

  it('rejects self-join from a non-member', async () => {
    const { host, code } = await roomWithBots(4, 3);
    await setTeams(code, host.token, 2);
    await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(host.token))
      .send({ teamAssignMode: 'self' })
      .expect(200);
    const outsider = await guest('Outsider');
    await request(server())
      .post(`/api/v1/rooms/${code}/team`)
      .set(auth(outsider.token))
      .send({ team: 0 })
      .expect(403);
  });

  it('leaves the host-only reseat endpoint untouched regardless of teamAssignMode', async () => {
    const { host, code } = await roomWithBots(4, 3);
    await setTeams(code, host.token, 2);
    await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(host.token))
      .send({ teamAssignMode: 'self' })
      .expect(200);
    const room = await request(server())
      .get(`/api/v1/rooms/${code}`)
      .set(auth(host.token))
      .expect(200);
    const ids: string[] = room.body.members.map((m: { userId: string }) => m.userId);
    await request(server())
      .post(`/api/v1/rooms/${code}/seats`)
      .set(auth(host.token))
      .send({ userIds: [...ids].reverse() })
      .expect(200);
  });
});
