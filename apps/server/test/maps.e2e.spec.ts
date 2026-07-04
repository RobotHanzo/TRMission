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

async function registered(email: string, displayName: string): Promise<{ token: string; id: string }> {
  const res = await request(server())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName })
    .expect(201);
  // Map authoring is feature-gated; this suite exercises the authoring flows themselves.
  await t.db
    .collection('users')
    .updateOne({ _id: res.body.user.id } as never, { $set: { features: ['mapBuilder'] } });
  return { token: res.body.accessToken, id: res.body.user.id };
}

const tinyDraft = {
  cities: [
    { id: 'm1', nameZh: '一', nameEn: 'M1', x: 10, y: 10, region: 'r', isIsland: false },
    { id: 'm2', nameZh: '二', nameEn: 'M2', x: 20, y: 10, region: 'r', isIsland: false },
  ],
  routes: [
    { id: 'mr1', a: 'm1', b: 'm2', color: 'RED', length: 2, ferryLocos: 0, isTunnel: false },
  ],
  tickets: [{ id: 'mt1', a: 'm1', b: 'm2', value: 2, deck: 'SHORT' }],
};

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);
afterAll(() => t.close());

describe('maps: CRUD', () => {
  it('lets a registered user create, read, update, and delete a custom map', async () => {
    const a = await registered('mapowner1@example.com', 'Owner1');
    const created = await request(server())
      .post('/api/v1/maps')
      .set(auth(a.token))
      .send({ nameZh: '我的地圖', nameEn: 'My Map' })
      .expect(201);
    expect(created.body.nameZh).toBe('我的地圖');
    expect(created.body.revision).toBe(1);
    const id: string = created.body.id;

    const got = await request(server()).get(`/api/v1/maps/${id}`).set(auth(a.token)).expect(200);
    expect(got.body.draft).toEqual({ cities: [], routes: [], tickets: [] });

    const updated = await request(server())
      .put(`/api/v1/maps/${id}`)
      .set(auth(a.token))
      .send({ draft: tinyDraft })
      .expect(200);
    expect(updated.body.draft.cities).toHaveLength(2);
    expect(updated.body.revision).toBe(2);

    const list = await request(server()).get('/api/v1/maps').set(auth(a.token)).expect(200);
    expect(list.body.map((m: { id: string }) => m.id)).toContain(id);

    await request(server()).delete(`/api/v1/maps/${id}`).set(auth(a.token)).expect(204);
    await request(server()).get(`/api/v1/maps/${id}`).set(auth(a.token)).expect(404);
  });

  it('404s (not 403) when a different user reads or edits someone else map', async () => {
    const a = await registered('mapowner2@example.com', 'Owner2');
    const b = await registered('mapother2@example.com', 'Other2');
    const created = await request(server())
      .post('/api/v1/maps')
      .set(auth(a.token))
      .send({ nameZh: 'X', nameEn: 'X' })
      .expect(201);
    const id: string = created.body.id;

    await request(server()).get(`/api/v1/maps/${id}`).set(auth(b.token)).expect(404);
    await request(server())
      .put(`/api/v1/maps/${id}`)
      .set(auth(b.token))
      .send({ nameZh: 'hijacked' })
      .expect(404);
    await request(server()).delete(`/api/v1/maps/${id}`).set(auth(b.token)).expect(404);
  });

  it('rejects an oversized draft (schema cap)', async () => {
    const a = await registered('mapowner3@example.com', 'Owner3');
    const created = await request(server())
      .post('/api/v1/maps')
      .set(auth(a.token))
      .send({ nameZh: 'X', nameEn: 'X' })
      .expect(201);
    const id: string = created.body.id;

    const tooManyCities = Array.from({ length: 121 }, (_, i) => ({
      id: `c${i}`,
      nameZh: `c${i}`,
      nameEn: `c${i}`,
      x: 0,
      y: 0,
      region: 'r',
      isIsland: false,
    }));
    await request(server())
      .put(`/api/v1/maps/${id}`)
      .set(auth(a.token))
      .send({ draft: { cities: tooManyCities, routes: [], tickets: [] } })
      .expect(400);
  });
});

describe('maps: guests cannot author', () => {
  it('rejects create/update/delete/share/clone for guests with 403', async () => {
    const g = await guest('Guesty');
    const a = await registered('mapowner4@example.com', 'Owner4');
    const created = await request(server())
      .post('/api/v1/maps')
      .set(auth(a.token))
      .send({ nameZh: 'X', nameEn: 'X' })
      .expect(201);
    const id: string = created.body.id;

    await request(server())
      .post('/api/v1/maps')
      .set(auth(g.token))
      .send({ nameZh: 'nope', nameEn: 'nope' })
      .expect(403);
    await request(server())
      .put(`/api/v1/maps/${id}`)
      .set(auth(g.token))
      .send({ nameZh: 'nope' })
      .expect(403);
    await request(server()).delete(`/api/v1/maps/${id}`).set(auth(g.token)).expect(403);
    await request(server()).post(`/api/v1/maps/${id}/share`).set(auth(g.token)).expect(403);

    // The strict mapBuilder gate covers the whole share flow: a guest (who can never hold
    // features) can neither peek a share code nor clone it.
    const shared = await request(server()).post(`/api/v1/maps/${id}/share`).set(auth(a.token)).expect(200);
    await request(server())
      .get(`/api/v1/maps/shared/${shared.body.shareCode}`)
      .set(auth(g.token))
      .expect(403);
    await request(server())
      .post(`/api/v1/maps/shared/${shared.body.shareCode}/clone`)
      .set(auth(g.token))
      .expect(403);
  });
});

describe('maps: share + clone', () => {
  it('mints/revokes a share code; peek never leaks ownerId; clone copies without the share code', async () => {
    const a = await registered('mapowner5@example.com', 'Owner5');
    const b = await registered('mapother5@example.com', 'Other5');
    const created = await request(server())
      .post('/api/v1/maps')
      .set(auth(a.token))
      .send({ nameZh: '分享地圖', nameEn: 'Shared Map' })
      .expect(201);
    const id: string = created.body.id;
    await request(server())
      .put(`/api/v1/maps/${id}`)
      .set(auth(a.token))
      .send({ draft: tinyDraft })
      .expect(200);

    const share = await request(server()).post(`/api/v1/maps/${id}/share`).set(auth(a.token)).expect(200);
    const code: string = share.body.shareCode;
    expect(code).toBeTruthy();

    const peek = await request(server())
      .get(`/api/v1/maps/shared/${code}`)
      .set(auth(b.token))
      .expect(200);
    expect(peek.body.nameZh).toBe('分享地圖');
    expect(peek.body.draft.cities).toHaveLength(2);
    expect(peek.body.ownerId).toBeUndefined();
    expect(peek.body.id).toBeUndefined();
    expect(peek.body.shareCode).toBeUndefined();

    const cloned = await request(server())
      .post(`/api/v1/maps/shared/${code}/clone`)
      .set(auth(b.token))
      .expect(201);
    expect(cloned.body.id).not.toBe(id);
    expect(cloned.body.nameZh).toContain('分享地圖');
    expect(cloned.body.draft.cities).toHaveLength(2);
    expect(cloned.body.shareCode).toBeUndefined();

    // The clone is owned by b, not a — a cannot read it.
    await request(server()).get(`/api/v1/maps/${cloned.body.id}`).set(auth(a.token)).expect(404);

    await request(server()).delete(`/api/v1/maps/${id}/share`).set(auth(a.token)).expect(204);
    await request(server()).get(`/api/v1/maps/shared/${code}`).set(auth(b.token)).expect(404);
  });

  it('404s for an unknown share code and an unknown content hash', async () => {
    const a = await registered('mapowner6@example.com', 'Owner6');
    await request(server()).get('/api/v1/maps/shared/NOSUCHCODE').set(auth(a.token)).expect(404);
    await request(server())
      .get(`/api/v1/maps/content/${'0'.repeat(64)}`)
      .set(auth(a.token))
      .expect(404);
  });
});

describe('maps: route bow', () => {
  it('accepts and round-trips an in-range route bow', async () => {
    const a = await registered('mapbow1@example.com', 'Bow1');
    const created = await request(server())
      .post('/api/v1/maps')
      .set(auth(a.token))
      .send({ nameZh: '彎', nameEn: 'Bow' })
      .expect(201);
    const id: string = created.body.id;

    const draft = { ...tinyDraft, routes: [{ ...tinyDraft.routes[0]!, bow: -3.5 }] };
    await request(server()).put(`/api/v1/maps/${id}`).set(auth(a.token)).send({ draft }).expect(200);

    const got = await request(server()).get(`/api/v1/maps/${id}`).set(auth(a.token)).expect(200);
    expect(got.body.draft.routes[0].bow).toBe(-3.5);
  });

  it('rejects a bow outside the shared limit (schema bound)', async () => {
    const a = await registered('mapbow2@example.com', 'Bow2');
    const created = await request(server())
      .post('/api/v1/maps')
      .set(auth(a.token))
      .send({ nameZh: '彎', nameEn: 'Bow' })
      .expect(201);
    const id: string = created.body.id;

    const draft = { ...tinyDraft, routes: [{ ...tinyDraft.routes[0]!, bow: 12.5 }] };
    await request(server()).put(`/api/v1/maps/${id}`).set(auth(a.token)).send({ draft }).expect(400);
  });
});
