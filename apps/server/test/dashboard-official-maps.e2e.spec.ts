import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { OFFICIAL_MAPS } from '@trm/map-data';
import { createTestApp, type TestApp } from './app';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const TAIWAN = OFFICIAL_MAPS[0]!.mapId;
const OTHER = OFFICIAL_MAPS[1]!.mapId;

async function registered(email: string, displayName: string) {
  const res = await request(server())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName })
    .expect(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

async function guest(displayName: string) {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

/** Switch off every official map except the ones named. */
const enableOnly = (token: string, ...mapIds: string[]) =>
  request(server())
    .put('/api/v1/dashboard/config/official-maps')
    .set(auth(token))
    .send({ enabledMapIds: mapIds })
    .expect(200);

let admin: Awaited<ReturnType<typeof registered>>;
let moderator: Awaited<ReturnType<typeof registered>>;

beforeAll(async () => {
  t = await createTestApp();
  admin = await registered('maps-cfg-admin@example.com', 'Admin');
  moderator = await registered('maps-cfg-mod@example.com', 'Mod');
  const now = new Date();
  await t.db.collection('dashboardAccounts').insertMany([
    { _id: admin.id, role: 'admin', grantedBy: 'test', grantedAt: now, updatedAt: now },
    { _id: moderator.id, role: 'moderator', grantedBy: 'test', grantedAt: now, updatedAt: now },
  ] as never[]);
}, 60_000);
afterAll(() => t.close());

// Every case starts from "everything on offer" — this config is a singleton shared by the suite.
afterEach(async () => {
  await t.db.collection('officialMapConfig').deleteMany({});
});

describe('dashboard config: official map availability', () => {
  it('starts with every shipped map enabled and round-trips a PUT, audited', async () => {
    const initial = await request(server())
      .get('/api/v1/dashboard/config/official-maps')
      .set(auth(admin.token))
      .expect(200);
    expect(initial.body.maps.map((m: { mapId: string }) => m.mapId)).toEqual(
      OFFICIAL_MAPS.map((m) => m.mapId),
    );
    expect(initial.body.maps.every((m: { enabled: boolean }) => m.enabled)).toBe(true);

    const put = await enableOnly(admin.token, TAIWAN);
    expect(put.body.maps.find((m: { mapId: string }) => m.mapId === OTHER).enabled).toBe(false);

    const after = await request(server())
      .get('/api/v1/dashboard/config/official-maps')
      .set(auth(admin.token))
      .expect(200);
    expect(after.body.maps.find((m: { mapId: string }) => m.mapId === OTHER).enabled).toBe(false);

    const audit = await request(server())
      .get('/api/v1/dashboard/audit')
      .set(auth(admin.token))
      .expect(200);
    const entry = audit.body.entries.find(
      (e: { action: string }) => e.action === 'config.officialMaps',
    );
    expect(entry).toBeDefined();
    expect(entry.params).toEqual({ before: OFFICIAL_MAPS.map((m) => m.mapId), after: [TAIWAN] });
  });

  it('is gated on config.features, rejects unknown ids, and keeps one map enabled', async () => {
    await request(server())
      .get('/api/v1/dashboard/config/official-maps')
      .set(auth(moderator.token))
      .expect(403);
    await request(server())
      .put('/api/v1/dashboard/config/official-maps')
      .set(auth(moderator.token))
      .send({ enabledMapIds: [TAIWAN] })
      .expect(403);

    await request(server())
      .put('/api/v1/dashboard/config/official-maps')
      .set(auth(admin.token))
      .send({ enabledMapIds: ['atlantis'] })
      .expect(400);
    await request(server())
      .put('/api/v1/dashboard/config/official-maps')
      .set(auth(admin.token))
      .send({ enabledMapIds: [] })
      .expect(400);

    // Neither rejection wrote anything: the picker still offers everything.
    const still = await request(server())
      .get('/api/v1/maps/official/enabled')
      .set(auth(admin.token))
      .expect(200);
    expect(still.body.mapIds).toEqual(OFFICIAL_MAPS.map((m) => m.mapId));
  });

  it('takes a switched-off map out of the picker, the settings PATCH, and game start', async () => {
    const a = await guest('Host');
    const b = await guest('Guest');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    // Selecting it is fine while it is on offer.
    await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(a.token))
      .send({ map: { source: 'official', mapId: OTHER } })
      .expect(200);

    await enableOnly(admin.token, TAIWAN);

    const enabled = await request(server())
      .get('/api/v1/maps/official/enabled')
      .set(auth(a.token))
      .expect(200);
    expect(enabled.body.mapIds).toEqual([TAIWAN]);

    // Re-selecting it now fails...
    await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(a.token))
      .send({ map: { source: 'official', mapId: OTHER } })
      .expect(400);

    // ...and so does starting the room that was already sitting on it.
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    for (const p of [a, b]) {
      await request(server())
        .post(`/api/v1/rooms/${code}/ready`)
        .set(auth(p.token))
        .send({ ready: true })
        .expect(200);
    }
    await request(server()).post(`/api/v1/rooms/${code}/start`).set(auth(a.token)).expect(400);

    // The room is also dropped from the public listing — it can never be started as it stands.
    await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(a.token))
      .send({ visibility: 'PUBLIC' })
      .expect(200);
    const publicRooms = await request(server()).get('/api/v1/rooms/public').expect(200);
    expect((publicRooms.body as { code: string }[]).map((r) => r.code)).not.toContain(code);

    // Switching it back on makes the very next start work.
    await enableOnly(admin.token, ...OFFICIAL_MAPS.map((m) => m.mapId));
    await request(server()).post(`/api/v1/rooms/${code}/start`).set(auth(a.token)).expect(200);
  });

  it('creates new rooms on a still-enabled map when the shipped default is switched off', async () => {
    await enableOnly(admin.token, OTHER);
    const a = await guest('Defaults');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    expect(room.body.settings.map).toEqual({ source: 'official', mapId: OTHER });
    // Practice games never touch the settings PATCH, so this is the only thing keeping them alive.
    await request(server()).post('/api/v1/rooms/practice').set(auth(a.token)).expect(200);
  });

  it('hides a switched-off map from the fork picker and refuses to fork it', async () => {
    const author = await registered('maps-cfg-author@example.com', 'Author');
    await t.db
      .collection('users')
      .updateOne({ _id: author.id } as never, { $set: { features: ['mapBuilder'] } });
    await enableOnly(admin.token, TAIWAN);

    const list = await request(server())
      .get('/api/v1/maps/official')
      .set(auth(author.token))
      .expect(200);
    expect(list.body.map((m: { mapId: string }) => m.mapId)).toEqual([TAIWAN]);

    await request(server()).post(`/api/v1/maps/fork/${OTHER}`).set(auth(author.token)).expect(404);
    await request(server()).post(`/api/v1/maps/fork/${TAIWAN}`).set(auth(author.token)).expect(201);
  });
});
