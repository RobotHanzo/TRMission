import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { DEFAULT_TRAIN_CAR_SKIN, TRAIN_CAR_SKINS } from '@trm/shared';
import { createTestApp, type TestApp } from './app';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const OTHER = TRAIN_CAR_SKINS.find((s) => s !== DEFAULT_TRAIN_CAR_SKIN)!;

async function registered(email: string, displayName: string) {
  const res = await request(server())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName })
    .expect(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

/** Switch off every skin pack except the ones named. */
const enableOnly = (token: string, ...skinIds: string[]) =>
  request(server())
    .put('/api/v1/dashboard/config/train-car-skins')
    .set(auth(token))
    .send({ enabledSkinIds: skinIds })
    .expect(200);

let admin: Awaited<ReturnType<typeof registered>>;
let moderator: Awaited<ReturnType<typeof registered>>;

beforeAll(async () => {
  t = await createTestApp();
  admin = await registered('skins-admin@example.com', 'Admin');
  moderator = await registered('skins-mod@example.com', 'Mod');
  const now = new Date();
  await t.db.collection('dashboardAccounts').insertMany([
    { _id: admin.id, role: 'admin', grantedBy: 'test', grantedAt: now, updatedAt: now },
    { _id: moderator.id, role: 'moderator', grantedBy: 'test', grantedAt: now, updatedAt: now },
  ] as never[]);
}, 60_000);
afterAll(() => t.close());

// Every case starts from "everything on offer" — this config is a singleton shared by the suite.
afterEach(async () => {
  await t.db.collection('trainCarSkinConfig').deleteMany({});
});

describe('dashboard config: train-car skin availability', () => {
  it('starts with every shipped pack enabled and round-trips a PUT, audited', async () => {
    const initial = await request(server())
      .get('/api/v1/dashboard/config/train-car-skins')
      .set(auth(admin.token))
      .expect(200);
    expect(initial.body.skins.map((s: { skinId: string }) => s.skinId)).toEqual([
      ...TRAIN_CAR_SKINS,
    ]);
    expect(initial.body.skins.every((s: { enabled: boolean }) => s.enabled)).toBe(true);
    // The default pack is the fallback, so the UI must render its toggle as unavailable.
    const def = initial.body.skins.find(
      (s: { skinId: string }) => s.skinId === DEFAULT_TRAIN_CAR_SKIN,
    );
    expect(def.locked).toBe(true);

    const put = await enableOnly(admin.token, DEFAULT_TRAIN_CAR_SKIN);
    expect(put.body.skins.find((s: { skinId: string }) => s.skinId === OTHER).enabled).toBe(false);

    const after = await request(server())
      .get('/api/v1/dashboard/config/train-car-skins')
      .set(auth(admin.token))
      .expect(200);
    expect(after.body.skins.find((s: { skinId: string }) => s.skinId === OTHER).enabled).toBe(
      false,
    );

    const audit = await request(server())
      .get('/api/v1/dashboard/audit')
      .set(auth(admin.token))
      .expect(200);
    const entry = audit.body.entries.find(
      (e: { action: string }) => e.action === 'config.trainCarSkins',
    );
    expect(entry).toBeDefined();
    expect(entry.params).toEqual({
      before: [...TRAIN_CAR_SKINS],
      after: [DEFAULT_TRAIN_CAR_SKIN],
    });
  });

  it('is gated on config.features and rejects unknown ids', async () => {
    await request(server())
      .get('/api/v1/dashboard/config/train-car-skins')
      .set(auth(moderator.token))
      .expect(403);
    await request(server())
      .put('/api/v1/dashboard/config/train-car-skins')
      .set(auth(moderator.token))
      .send({ enabledSkinIds: [DEFAULT_TRAIN_CAR_SKIN] })
      .expect(403);

    await request(server())
      .put('/api/v1/dashboard/config/train-car-skins')
      .set(auth(admin.token))
      .send({ enabledSkinIds: ['neonNightRide'] })
      .expect(400);

    // The rejection wrote nothing: the picker still offers everything.
    const still = await request(server())
      .get('/api/v1/skins/train-cars/enabled')
      .set(auth(admin.token))
      .expect(200);
    expect(still.body.skinIds).toEqual([...TRAIN_CAR_SKINS]);
  });

  it('always keeps the default pack on offer, even when the PUT omits it', async () => {
    // Nothing is drawable without a fallback, so an empty set is not an error — it collapses to
    // the default (unlike official maps, where an empty set 400s).
    const res = await enableOnly(admin.token);
    expect(res.body.skins.filter((s: { enabled: boolean }) => s.enabled)).toHaveLength(1);
    const enabled = await request(server())
      .get('/api/v1/skins/train-cars/enabled')
      .set(auth(admin.token))
      .expect(200);
    expect(enabled.body.skinIds).toEqual([DEFAULT_TRAIN_CAR_SKIN]);
  });

  it('leaves an affected account its stored choice, so switching back restores it', async () => {
    // The asymmetry with official maps: skins are cosmetic and preferences save as one blob, so
    // a switched-off pack must not start 400-ing this account's theme and language changes.
    const player = await registered('skins-player@example.com', 'Player');
    const picked = await request(server())
      .patch('/api/v1/auth/me/preferences')
      .set(auth(player.token))
      .send({ trainCarSkin: OTHER })
      .expect(200);
    expect(picked.body.preferences.trainCarSkin).toBe(OTHER);

    await enableOnly(admin.token, DEFAULT_TRAIN_CAR_SKIN);

    const offered = await request(server())
      .get('/api/v1/skins/train-cars/enabled')
      .set(auth(player.token))
      .expect(200);
    expect(offered.body.skinIds).not.toContain(OTHER);

    // Still accepted, still stored — the client resolves it to the default for rendering.
    const stillSaves = await request(server())
      .patch('/api/v1/auth/me/preferences')
      .set(auth(player.token))
      .send({ theme: 'dark' })
      .expect(200);
    expect(stillSaves.body.preferences.theme).toBe('dark');
    expect(stillSaves.body.preferences.trainCarSkin).toBe(OTHER);
  });
});

describe('the trainCarSkin preference', () => {
  it('defaults for a fresh account and rejects an unknown pack', async () => {
    const player = await registered('skins-prefs@example.com', 'Prefs');
    const me = await request(server()).get('/api/v1/auth/me').set(auth(player.token)).expect(200);
    expect(me.body.preferences.trainCarSkin).toBe(DEFAULT_TRAIN_CAR_SKIN);

    await request(server())
      .patch('/api/v1/auth/me/preferences')
      .set(auth(player.token))
      .send({ trainCarSkin: 'neonNightRide' })
      .expect(400);
  });

  it('applies a PATCH per field, so an older client cannot blank one it predates', async () => {
    const player = await registered('skins-merge@example.com', 'Merge');
    await request(server())
      .patch('/api/v1/auth/me/preferences')
      .set(auth(player.token))
      .send({ trainCarSkin: OTHER, boardLayout: 'tray' })
      .expect(200);

    // Exactly what a build from before this preference existed sends: all four old fields.
    const legacy = await request(server())
      .patch('/api/v1/auth/me/preferences')
      .set(auth(player.token))
      .send({ theme: 'light', colorBlind: true, locale: 'en', boardLayout: 'rail' })
      .expect(200);
    expect(legacy.body.preferences).toEqual({
      theme: 'light',
      colorBlind: true,
      locale: 'en',
      boardLayout: 'rail',
      trainCarSkin: OTHER,
    });
  });

  it('fills the default in for a document written before the field existed', async () => {
    const player = await registered('skins-legacydoc@example.com', 'Legacy');
    await t.db
      .collection('users')
      .updateOne({ _id: player.id } as never, { $unset: { 'preferences.trainCarSkin': '' } });
    const me = await request(server()).get('/api/v1/auth/me').set(auth(player.token)).expect(200);
    expect(me.body.preferences.trainCarSkin).toBe(DEFAULT_TRAIN_CAR_SKIN);
  });
});
