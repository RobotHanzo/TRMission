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

describe('lobby: bot management (host only)', () => {
  it('lets the host add and remove bots of chosen difficulties', async () => {
    const host = await guest('Host');
    const code: string = (
      await request(server()).post('/api/v1/rooms').set(auth(host.token)).send({}).expect(201)
    ).body.code;

    const withEasy = await request(server())
      .post(`/api/v1/rooms/${code}/bots`)
      .set(auth(host.token))
      .send({ difficulty: 'EASY' })
      .expect(200);
    const withHard = await request(server())
      .post(`/api/v1/rooms/${code}/bots`)
      .set(auth(host.token))
      .send({ difficulty: 'HARD' });
    expect(withEasy.body.members).toHaveLength(2);
    expect(withHard.body.members).toHaveLength(3);

    const bots = withHard.body.members.filter((m: { isBot?: boolean }) => m.isBot);
    expect(bots).toHaveLength(2);
    expect(bots.map((b: { difficulty: string }) => b.difficulty).sort()).toEqual(['EASY', 'HARD']);
    expect(bots.every((b: { ready: boolean }) => b.ready)).toBe(true);

    const removed = await request(server())
      .post(`/api/v1/rooms/${code}/bots/${encodeURIComponent(bots[0].userId)}/remove`)
      .set(auth(host.token))
      .expect(200);
    expect(removed.body.members.filter((m: { isBot?: boolean }) => m.isBot)).toHaveLength(1);
    // Seats stay contiguous after a removal.
    expect(removed.body.members.map((m: { seat: number }) => m.seat)).toEqual([0, 1]);
  });

  it('rejects bot management from non-hosts and validates difficulty', async () => {
    const host = await guest('Owner');
    const other = await guest('Guest2');
    const code: string = (
      await request(server()).post('/api/v1/rooms').set(auth(host.token)).send({}).expect(201)
    ).body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(other.token)).expect(200);

    // A non-host cannot add bots.
    await request(server())
      .post(`/api/v1/rooms/${code}/bots`)
      .set(auth(other.token))
      .send({ difficulty: 'EASY' })
      .expect(403);

    // Invalid difficulty is rejected by validation.
    await request(server())
      .post(`/api/v1/rooms/${code}/bots`)
      .set(auth(host.token))
      .send({ difficulty: 'IMPOSSIBLE' })
      .expect(400);
  });

  it('starts a game for one human + one bot (a 2-seat table)', async () => {
    const host = await guest('Solo');
    const code: string = (
      await request(server()).post('/api/v1/rooms').set(auth(host.token)).send({}).expect(201)
    ).body.code;
    await request(server())
      .post(`/api/v1/rooms/${code}/bots`)
      .set(auth(host.token))
      .send({ difficulty: 'EASY' })
      .expect(200);
    await request(server())
      .post(`/api/v1/rooms/${code}/ready`)
      .set(auth(host.token))
      .send({ ready: true })
      .expect(200);
    const started = await request(server())
      .post(`/api/v1/rooms/${code}/start`)
      .set(auth(host.token))
      .expect(200);
    expect(started.body.gameId).toBeTruthy();
    expect(started.body.ticket).toBeTruthy();
  });
});
