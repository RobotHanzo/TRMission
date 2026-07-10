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

describe('lobby: join falls back to spectating when full', () => {
  it('seats a joiner as a spectator when the lobby is full and spectating is allowed', async () => {
    const a = await guest('Ada');
    const b = await guest('Bo');
    const c = await guest('Cy');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({ maxPlayers: 2 })
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);

    const joined = await request(server())
      .post(`/api/v1/rooms/${code}/join`)
      .set(auth(c.token))
      .expect(200);
    expect(joined.body.status).toBe('LOBBY');
    expect(joined.body.members.map((m: { userId: string }) => m.userId)).toEqual([a.id, b.id]);
    expect(joined.body.spectators).toEqual([{ userId: c.id, displayName: 'Cy', isGuest: true }]);
  });

  it('still rejects a full room when spectating is disabled', async () => {
    const a = await guest('Ada2');
    const b = await guest('Bo2');
    const c = await guest('Cy2');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({ maxPlayers: 2 })
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(a.token))
      .send({ allowSpectating: false })
      .expect(200);

    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(c.token)).expect(400);
  });

  it('does not promote a full-room spectator to a freed seat on a repeat join', async () => {
    const a = await guest('Ada3');
    const b = await guest('Bo3');
    const c = await guest('Cy3');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({ maxPlayers: 2 })
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    // c lands as a spectator (room full)
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(c.token)).expect(200);
    // b leaves, freeing a seat
    await request(server()).post(`/api/v1/rooms/${code}/leave`).set(auth(b.token)).expect(200);

    const rejoined = await request(server())
      .post(`/api/v1/rooms/${code}/join`)
      .set(auth(c.token))
      .expect(200);
    expect(rejoined.body.members.map((m: { userId: string }) => m.userId)).toEqual([a.id]);
    expect(rejoined.body.spectators).toEqual([{ userId: c.id, displayName: 'Cy3', isGuest: true }]);
  });
});
