import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { viewToSnapshot } from '@trm/codec';
import type { UserFeature } from '@trm/shared';
import { createTestApp, type TestApp } from './app';
import { GameRegistry } from '../src/game/game-registry';
import { RoomRepo } from '../src/lobby/room.repo';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const srv = (app: TestApp) => app.app.getHttpServer();

async function guest(app: TestApp, displayName: string): Promise<{ token: string; id: string }> {
  const res = await request(srv(app)).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

/** Grant features directly in Mongo — same helper pattern as feature-gating.e2e.spec.ts. */
async function grant(app: TestApp, userId: string, features: UserFeature[]) {
  await app.db.collection('users').updateOne({ _id: userId } as never, { $set: { features } });
}

/** Create a 2-player room, optionally PATCH settings, mark everyone ready. */
async function readyRoom(
  app: TestApp,
  patch?: Record<string, unknown>,
): Promise<{ code: string; host: { token: string; id: string } }> {
  const host = await guest(app, 'Host');
  const other = await guest(app, 'Guest');
  const room = await request(srv(app))
    .post('/api/v1/rooms')
    .set(auth(host.token))
    .send({})
    .expect(201);
  const code: string = room.body.code;
  await request(srv(app)).post(`/api/v1/rooms/${code}/join`).set(auth(other.token)).expect(200);
  if (patch) {
    await request(srv(app))
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(host.token))
      .send(patch)
      .expect(200);
  }
  for (const u of [host, other]) {
    await request(srv(app))
      .post(`/api/v1/rooms/${code}/ready`)
      .set(auth(u.token))
      .send({ ready: true })
      .expect(200);
  }
  return { code, host };
}

/** The genesis snapshot for a started game (null viewer = the public projection). */
function genesisSnapshot(app: TestApp, gameId: string) {
  const match = app.app.get(GameRegistry).get(gameId);
  if (!match) throw new Error('match not registered');
  return viewToSnapshot(match.session.project(null), match.session.stateVersion, null);
}

describe("lobby: random-events is gated by the host's randomEvents feature", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    // This suite tests the per-account gate boundary explicitly (grant()/no grant), so start
    // from an empty global default — randomEvents is a real default elsewhere (feature-gating).
    await t.db
      .collection('featureDefaults')
      .updateOne({ _id: 'singleton' } as never, { $set: { features: [] } }, { upsert: true });
  }, 60_000);
  afterAll(() => t.close());

  it('rejects a settings PATCH that turns events on without the feature, but allows patching to off', async () => {
    const host = await guest(t, 'H');
    const room = await request(srv(t))
      .post('/api/v1/rooms')
      .set(auth(host.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;

    const denied = await request(srv(t))
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(host.token))
      .send({ eventsMode: 'light' })
      .expect(403);
    expect(denied.body.code).toBe('FEATURE_DISABLED');

    // Patching to 'off' is always allowed (idempotent no-op relative to the default).
    const ok = await request(srv(t))
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(host.token))
      .send({ eventsMode: 'off' })
      .expect(200);
    expect(ok.body.settings.eventsMode).toBe('off');
  });

  it('downgrades a room whose stored settings somehow carry a non-off mode to off at start', async () => {
    const { code, host } = await readyRoom(t);
    // Bypass the settings guard the way a stale doc could: write the mode straight onto the room
    // via the repo (no service enforcement), then start without the feature granted.
    const stored = await t.app.get(RoomRepo).updateSettings(code, host.id, { eventsMode: 'light' });
    expect(stored).not.toBe('forbidden');

    const started = await request(srv(t))
      .post(`/api/v1/rooms/${code}/start`)
      .set(auth(host.token))
      .expect(200);
    const snap = genesisSnapshot(t, started.body.gameId);
    expect(snap.gameSettings?.eventsMode).toBe('off');
    expect(snap.randomEvents).toBeUndefined(); // 'off' ⇒ no events block at all
  });

  it('accepts an events PATCH once the host holds the feature, and echoes it back on the RoomView', async () => {
    const host = await guest(t, 'H2');
    await grant(t, host.id, ['randomEvents']);
    const room = await request(srv(t))
      .post('/api/v1/rooms')
      .set(auth(host.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    const patched = await request(srv(t))
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(host.token))
      .send({ eventsMode: 'light' })
      .expect(200);
    expect(patched.body.settings.eventsMode).toBe('light');
  });

  it('threads the configured mode into the started game (snapshot game_settings + random_events)', async () => {
    const host = await guest(t, 'H3');
    await grant(t, host.id, ['randomEvents']);
    const other = await guest(t, 'G3');
    const room = await request(srv(t))
      .post('/api/v1/rooms')
      .set(auth(host.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(srv(t)).post(`/api/v1/rooms/${code}/join`).set(auth(other.token)).expect(200);
    await request(srv(t))
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(host.token))
      .send({ eventsMode: 'light' })
      .expect(200);
    for (const u of [host, other]) {
      await request(srv(t))
        .post(`/api/v1/rooms/${code}/ready`)
        .set(auth(u.token))
        .send({ ready: true })
        .expect(200);
    }
    const started = await request(srv(t))
      .post(`/api/v1/rooms/${code}/start`)
      .set(auth(host.token))
      .expect(200);
    const snap = genesisSnapshot(t, started.body.gameId);
    expect(snap.gameSettings?.eventsMode).toBe('light');
    // A non-off game carries the events block from genesis (schedule is drawn at setup).
    expect(snap.randomEvents).toBeDefined();
    expect(snap.randomEvents?.mode).toBe('light');
  });

  it('downgrades to off at start when the feature is revoked after configuration (no stranded room)', async () => {
    const host = await guest(t, 'H4');
    await grant(t, host.id, ['randomEvents']);
    const other = await guest(t, 'G4');
    const room = await request(srv(t))
      .post('/api/v1/rooms')
      .set(auth(host.token))
      .send({})
      .expect(201);
    const roomCode: string = room.body.code;
    await request(srv(t)).post(`/api/v1/rooms/${roomCode}/join`).set(auth(other.token)).expect(200);
    await request(srv(t))
      .patch(`/api/v1/rooms/${roomCode}/settings`)
      .set(auth(host.token))
      .send({ eventsMode: 'moderate' })
      .expect(200);
    for (const u of [host, other]) {
      await request(srv(t))
        .post(`/api/v1/rooms/${roomCode}/ready`)
        .set(auth(u.token))
        .send({ ready: true })
        .expect(200);
    }
    // Simulate a maintainer revoking the feature between configuration and start.
    await grant(t, host.id, []);
    const started = await request(srv(t))
      .post(`/api/v1/rooms/${roomCode}/start`)
      .set(auth(host.token))
      .expect(200);
    const snap = genesisSnapshot(t, started.body.gameId);
    expect(snap.gameSettings?.eventsMode).toBe('off');
    expect(snap.randomEvents).toBeUndefined();
  });
});
