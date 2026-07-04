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

describe('lobby: rematch vote', () => {
  it('lets a seated member cast and change an advisory rematch vote', async () => {
    const a = await guest('Ada');
    const b = await guest('Bo');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);

    const voted = await request(server())
      .post(`/api/v1/rooms/${code}/rematch-vote`)
      .set(auth(b.token))
      .send({ wantsRematch: true })
      .expect(200);
    const bMember = voted.body.members.find((m: { userId: string }) => m.userId === b.id);
    expect(bMember.wantsRematch).toBe(true);

    const changed = await request(server())
      .post(`/api/v1/rooms/${code}/rematch-vote`)
      .set(auth(b.token))
      .send({ wantsRematch: false })
      .expect(200);
    expect(
      changed.body.members.find((m: { userId: string }) => m.userId === b.id).wantsRematch,
    ).toBe(false);
  });

  it('rejects a vote from someone who is not a member of the room', async () => {
    const a = await guest('Ada2');
    const outsider = await guest('Out');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;

    await request(server())
      .post(`/api/v1/rooms/${code}/rematch-vote`)
      .set(auth(outsider.token))
      .send({ wantsRematch: true })
      .expect(403);
  });
});
