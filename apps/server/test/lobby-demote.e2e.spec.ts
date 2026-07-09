import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function guest(displayName: string): Promise<{ token: string; id: string }> {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);
afterAll(() => t.close());

describe('lobby: demote to spectator / rejoin as player', () => {
  it('lets a seated member demote, freeing and renumbering the seat', async () => {
    const a = await guest('Ada');
    const b = await guest('Bo');
    const c = await guest('Cy');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(c.token)).expect(200);

    const demoted = await request(server())
      .post(`/api/v1/rooms/${code}/watch`)
      .set(auth(b.token))
      .expect(200);
    expect(demoted.body.members.map((m: { userId: string }) => m.userId)).toEqual([a.id, c.id]);
    expect(demoted.body.members.map((m: { seat: number }) => m.seat)).toEqual([0, 1]);
    expect(demoted.body.spectators).toEqual([{ userId: b.id, displayName: 'Bo', isGuest: true }]);
  });

  it('blocks the host from demoting to spectator (owners cannot spectate)', async () => {
    const a = await guest('Ada2');
    const b = await guest('Bo2');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);

    await request(server()).post(`/api/v1/rooms/${code}/watch`).set(auth(a.token)).expect(400);
    // The room is untouched: the host stays host, both members remain seated.
    const after = await request(server())
      .get(`/api/v1/rooms/${code}`)
      .set(auth(a.token))
      .expect(200);
    expect(after.body.hostId).toBe(a.id);
    expect(after.body.members.map((m: { userId: string }) => m.userId)).toEqual([a.id, b.id]);
  });

  it("blocks demoting the room's only member", async () => {
    const a = await guest('Solo');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/watch`).set(auth(a.token)).expect(400);
  });

  it('blocks demoting when the room disables spectating', async () => {
    const a = await guest('Ada3');
    const b = await guest('Bo3');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(a.token))
      .send({ allowSpectating: false })
      .expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/watch`).set(auth(b.token)).expect(400);
  });

  it('blocks watch from a non-member, and rejoin from a non-spectator', async () => {
    const a = await guest('Ada4');
    const outsider = await guest('Out');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server())
      .post(`/api/v1/rooms/${code}/watch`)
      .set(auth(outsider.token))
      .expect(403);
    await request(server())
      .post(`/api/v1/rooms/${code}/rejoin`)
      .set(auth(outsider.token))
      .expect(403);
  });

  it('lets a spectator rejoin an open seat', async () => {
    const a = await guest('Ada5');
    const b = await guest('Bo5');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/watch`).set(auth(b.token)).expect(200);

    const rejoined = await request(server())
      .post(`/api/v1/rooms/${code}/rejoin`)
      .set(auth(b.token))
      .expect(200);
    expect(rejoined.body.spectators).toEqual([]);
    expect(rejoined.body.members.map((m: { userId: string }) => m.userId)).toEqual([a.id, b.id]);
  });

  it('blocks rejoin once the freed seat has been retaken', async () => {
    const a = await guest('Ada6');
    const b = await guest('Bo6');
    const c = await guest('Cy6');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({ maxPlayers: 2 })
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/watch`).set(auth(b.token)).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(c.token)).expect(200);

    await request(server()).post(`/api/v1/rooms/${code}/rejoin`).set(auth(b.token)).expect(400);
  });

  it('blocks demote/rejoin once the game has started', async () => {
    const a = await guest('Ada7');
    const b = await guest('Bo7');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server())
      .post(`/api/v1/rooms/${code}/ready`)
      .set(auth(a.token))
      .send({ ready: true })
      .expect(200);
    await request(server())
      .post(`/api/v1/rooms/${code}/ready`)
      .set(auth(b.token))
      .send({ ready: true })
      .expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/start`).set(auth(a.token)).expect(200);

    await request(server()).post(`/api/v1/rooms/${code}/watch`).set(auth(b.token)).expect(400);
  });
});
