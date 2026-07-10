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

describe('lobby: practice with bots (one-call quick start)', () => {
  it('starts a game with one easy + one medium bot and returns code/gameId/ticket', async () => {
    const host = await guest('Practicer');

    const res = await request(server())
      .post('/api/v1/rooms/practice')
      .set(auth(host.token))
      .expect(200);
    expect(res.body.code).toBeTruthy();
    expect(res.body.gameId).toBeTruthy();
    expect(res.body.ticket).toBeTruthy();

    const room = await request(server())
      .get(`/api/v1/rooms/${res.body.code}`)
      .set(auth(host.token))
      .expect(200);
    expect(room.body.status).toBe('STARTED');
    expect(room.body.members).toHaveLength(3);

    const bots = room.body.members.filter((m: { isBot?: boolean }) => m.isBot);
    expect(bots.map((b: { difficulty: string }) => b.difficulty).sort()).toEqual(['EASY', 'MEDIUM']);

    const humans = room.body.members.filter((m: { isBot?: boolean }) => !m.isBot);
    expect(humans).toHaveLength(1);
    expect(humans[0].userId).toBe(host.id);
  });
});
