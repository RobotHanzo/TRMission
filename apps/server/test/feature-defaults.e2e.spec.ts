import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
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

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);
afterAll(() => t.close());

describe('global feature defaults', () => {
  it('a feature present only in the global default set still opens a FeatureGuard route', async () => {
    const a = await registered('def-maps@example.com', 'DefMaps');
    await request(server()).get('/api/v1/maps').set(auth(a.token)).expect(403);

    await t.db
      .collection('featureDefaults')
      .updateOne(
        { _id: 'singleton' } as never,
        { $set: { features: ['mapBuilder'] } },
        { upsert: true },
      );

    await request(server()).get('/api/v1/maps').set(auth(a.token)).expect(200);
  });

  it("an account's own explicit grant still works when the global default is empty", async () => {
    await t.db
      .collection('featureDefaults')
      .updateOne({ _id: 'singleton' } as never, { $set: { features: [] } }, { upsert: true });
    const a = await registered('def-grant@example.com', 'DefGrant');
    await request(server()).get('/api/v1/maps').set(auth(a.token)).expect(403);
    await t.db
      .collection('users')
      .updateOne({ _id: a.id } as never, { $set: { features: ['mapBuilder'] } });
    await request(server()).get('/api/v1/maps').set(auth(a.token)).expect(200);
  });
});
