import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { CONTENT_HASH } from '@trm/engine';
import { createTestApp, type TestApp } from './app';
import { GameRegistry } from '../src/game/game-registry';

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

describe('lobby: map selector', () => {
  it('defaults a fresh room to the taiwan official map', async () => {
    const a = await guest('Alice');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    expect(room.body.settings.map).toEqual({ source: 'official', mapId: 'taiwan' });
    expect(room.body.mapName).toEqual({ zh: '台灣本島與離島', en: 'Taiwan & Outlying Islands' });
  });

  it('lets the host re-select the same official map', async () => {
    const a = await guest('Host');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    const updated = await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(a.token))
      .send({ map: { source: 'official', mapId: 'taiwan' } })
      .expect(200);
    expect(updated.body.settings.map).toEqual({ source: 'official', mapId: 'taiwan' });
  });

  it('rejects an unknown official mapId on settings patch', async () => {
    const a = await guest('Host2');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(a.token))
      .send({ map: { source: 'official', mapId: 'nonexistent-map' } })
      .expect(400);
  });

  it('rejects a custom map selector pointing at a nonexistent/unowned map (404)', async () => {
    const a = await guest('Host3');
    // Grant the feature so the gate doesn't mask the ownership 404 this test is about.
    await t.db
      .collection('users')
      .updateOne({ _id: a.id } as never, { $set: { features: ['mapBuilder'] } });
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(a.token))
      .send({ map: { source: 'custom', customMapId: 'abc123' } })
      .expect(404);
  });

  it('rejects a custom map selector outright when the host lacks the mapBuilder feature (403)', async () => {
    const a = await guest('Host3b');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    const res = await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(a.token))
      .send({ map: { source: 'custom', customMapId: 'abc123' } })
      .expect(403);
    expect(res.body.code).toBe('FEATURE_DISABLED');
  });

  it('resolves the selected official map into the started game config', async () => {
    const a = await guest('A');
    const b = await guest('B');
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
    const started = await request(server())
      .post(`/api/v1/rooms/${code}/start`)
      .set(auth(a.token))
      .expect(200);

    const match = t.app.get(GameRegistry).get(started.body.gameId);
    expect(match).toBeTruthy();
    expect(match!.session.raw().contentHash).toBe(CONTENT_HASH);
  });
});
