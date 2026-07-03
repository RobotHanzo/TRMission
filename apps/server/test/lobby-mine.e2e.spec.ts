import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';
import type { GameDoc } from '../src/persistence/types';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function guest(displayName: string): Promise<{ token: string; id: string }> {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

const mine = async (token: string): Promise<{ code: string; status: string }[]> =>
  (await request(server()).get('/api/v1/rooms/mine').set(auth(token)).expect(200)).body;

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);

afterAll(() => t.close());

describe('lobby: GET /rooms/mine (active rooms to rejoin)', () => {
  it('lists lobbies and live games for members only, and drops finished/left rooms', async () => {
    const a = await guest('Amy');
    const b = await guest('Bo');

    expect(await mine(a.token)).toEqual([]);

    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;

    // The host sees their lobby; a stranger does not.
    expect((await mine(a.token)).map((r) => r.code)).toEqual([code]);
    expect(await mine(b.token)).toEqual([]);

    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    expect((await mine(b.token)).map((r) => r.code)).toEqual([code]);

    for (const u of [a, b]) {
      await request(server())
        .post(`/api/v1/rooms/${code}/ready`)
        .set(auth(u.token))
        .send({ ready: true })
        .expect(200);
    }
    const started = await request(server())
      .post(`/api/v1/rooms/${code}/start`)
      .set(auth(a.token))
      .expect(200);

    // A started room with a LIVE game is still rejoinable.
    const live = await mine(a.token);
    expect(live.map((r) => r.code)).toEqual([code]);
    expect(live[0]?.status).toBe('STARTED');

    // Once the game completes, the room is history — not a rejoin target.
    await t.db
      .collection<GameDoc>('games')
      .updateOne({ _id: started.body.gameId }, { $set: { status: 'COMPLETED' } });
    expect(await mine(a.token)).toEqual([]);
    expect(await mine(b.token)).toEqual([]);
  });

  it('drops a lobby the user left, and requires auth', async () => {
    const a = await guest('Ana');
    const code: string = (
      await request(server()).post('/api/v1/rooms').set(auth(a.token)).send({}).expect(201)
    ).body.code;
    expect((await mine(a.token)).map((r) => r.code)).toEqual([code]);

    await request(server()).post(`/api/v1/rooms/${code}/leave`).set(auth(a.token)).expect(200);
    expect(await mine(a.token)).toEqual([]);

    await request(server()).get('/api/v1/rooms/mine').expect(401);
  });
});
