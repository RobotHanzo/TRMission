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

describe('lobby: preset chat', () => {
  it('lets a room member send a preset message, visible to every member', async () => {
    const a = await guest('Ada');
    const b = await guest('Bo');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);

    const sent = await request(server())
      .post(`/api/v1/rooms/${code}/chat`)
      .set(auth(a.token))
      .send({ presetId: 'GOOD_LUCK' })
      .expect(200);
    expect(sent.body.chat).toHaveLength(1);
    expect(sent.body.chat[0]).toMatchObject({ userId: a.id, presetId: 'GOOD_LUCK' });

    // The other member sees it too on their next read.
    const read = await request(server())
      .get(`/api/v1/rooms/${code}`)
      .set(auth(b.token))
      .expect(200);
    expect(read.body.chat[0]).toMatchObject({ userId: a.id, presetId: 'GOOD_LUCK' });
  });

  it('rejects an unrecognized preset id with a 400', async () => {
    const a = await guest('Ada2');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;

    await request(server())
      .post(`/api/v1/rooms/${code}/chat`)
      .set(auth(a.token))
      .send({ presetId: 'NOT_A_PRESET' })
      .expect(400);
  });

  it('rejects chat from someone who is not a member of the room', async () => {
    const a = await guest('Ada3');
    const outsider = await guest('Out');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;

    await request(server())
      .post(`/api/v1/rooms/${code}/chat`)
      .set(auth(outsider.token))
      .send({ presetId: 'GOOD_LUCK' })
      .expect(403);
  });

  it('rate-limits: 5 allowed in the window, the 6th is rejected', async () => {
    const a = await guest('Ada4');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;

    for (let i = 0; i < 5; i++) {
      await request(server())
        .post(`/api/v1/rooms/${code}/chat`)
        .set(auth(a.token))
        .send({ presetId: 'YES' })
        .expect(200);
    }
    await request(server())
      .post(`/api/v1/rooms/${code}/chat`)
      .set(auth(a.token))
      .send({ presetId: 'YES' })
      .expect(400);
  });

  it('caps the persisted chat log at 30 entries', async () => {
    const a = await guest('Ada5');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;

    // 35 sends spread across enough time to dodge the 5-per-5s rate limit: 7 bursts of 5,
    // pausing between bursts. Vitest's default timeout is generous enough for this in CI.
    for (let burst = 0; burst < 7; burst++) {
      for (let i = 0; i < 5; i++) {
        await request(server())
          .post(`/api/v1/rooms/${code}/chat`)
          .set(auth(a.token))
          .send({ presetId: 'YES' })
          .expect(200);
      }
      await new Promise((r) => setTimeout(r, 5100));
    }
    const read = await request(server())
      .get(`/api/v1/rooms/${code}`)
      .set(auth(a.token))
      .expect(200);
    expect(read.body.chat).toHaveLength(30);
  }, 60_000);
});
