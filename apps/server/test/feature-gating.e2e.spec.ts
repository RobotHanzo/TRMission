import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { UserFeature } from '@trm/shared';
import { createTestApp, type TestApp } from './app';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function registered(email: string, displayName: string) {
  const res = await request(server())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName })
    .expect(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

/** Grant features directly in Mongo — the dashboard API arrives in a later task. */
async function grant(db: TestApp['db'], userId: string, features: UserFeature[]) {
  await db.collection('users').updateOne({ _id: userId } as never, { $set: { features } });
}

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);
afterAll(() => t.close());

describe('PublicUser.features', () => {
  it('defaults to [] and reflects grants instantly (no re-login)', async () => {
    const a = await registered('feat-me@example.com', 'FeatMe');
    const before = await request(server()).get('/api/v1/auth/me').set(auth(a.token)).expect(200);
    expect(before.body.features).toEqual([]);

    await grant(t.db, a.id, ['mapBuilder']);
    const after = await request(server()).get('/api/v1/auth/me').set(auth(a.token)).expect(200);
    expect(after.body.features).toEqual(['mapBuilder']);
  });
});
