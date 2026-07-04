import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { viewToSnapshot } from '@trm/codec';
import { createTestApp, type TestApp } from './app';
import { GameRegistry } from '../src/game/game-registry';
import { RoomRepo } from '../src/lobby/room.repo';
import { LobbyConfig } from '../src/lobby/lobby-config';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const srv = (app: TestApp) => app.app.getHttpServer();

async function guest(app: TestApp, displayName: string): Promise<{ token: string; id: string }> {
  const res = await request(srv(app))
    .post('/api/v1/auth/guest')
    .send({ displayName })
    .expect(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

/** Create a 2-player room, optionally PATCH settings, mark everyone ready. */
async function readyRoom(
  app: TestApp,
  patch?: Record<string, unknown>,
): Promise<{ code: string; host: { token: string; id: string } }> {
  const host = await guest(app, 'Host');
  const other = await guest(app, 'Guest');
  const room = await request(srv(app)).post('/api/v1/rooms').set(auth(host.token)).send({}).expect(201);
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

describe('lobby: random-events flag OFF (default) — server enforcement', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp(); // no override → env default (unset ⇒ OFF)
  }, 60_000);
  afterAll(() => t.close());

  it('GET /rooms/config reports the option disabled', async () => {
    const me = await guest(t, 'Cfg');
    const res = await request(srv(t)).get('/api/v1/rooms/config').set(auth(me.token)).expect(200);
    expect(res.body).toEqual({ randomEventsEnabled: false });
  });

  it('rejects a settings PATCH that turns events on, but allows patching to off', async () => {
    const host = await guest(t, 'H');
    const room = await request(srv(t)).post('/api/v1/rooms').set(auth(host.token)).send({}).expect(201);
    const code: string = room.body.code;

    const denied = await request(srv(t))
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(host.token))
      .send({ eventsMode: 'light' })
      .expect(403);
    expect(denied.body.message).toMatch(/random events/i);

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
    // Bypass the settings guard the way a flag flip or stale doc could: write the mode straight
    // onto the room via the repo (no service enforcement), then start with the flag off.
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
});

describe('lobby: random-events flag ON — configuration reaches the engine', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ lobbyConfig: { randomEvents: true } });
  }, 60_000);
  afterAll(() => t.close());

  it('GET /rooms/config reports the option enabled', async () => {
    const me = await guest(t, 'Cfg');
    const res = await request(srv(t)).get('/api/v1/rooms/config').set(auth(me.token)).expect(200);
    expect(res.body).toEqual({ randomEventsEnabled: true });
  });

  it('accepts an events PATCH and echoes it back on the RoomView', async () => {
    const host = await guest(t, 'H');
    const room = await request(srv(t)).post('/api/v1/rooms').set(auth(host.token)).send({}).expect(201);
    const code: string = room.body.code;
    const patched = await request(srv(t))
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(host.token))
      .send({ eventsMode: 'light' })
      .expect(200);
    expect(patched.body.settings.eventsMode).toBe('light');
  });

  it('threads the configured mode into the started game (snapshot game_settings + random_events)', async () => {
    const { code, host } = await readyRoom(t, { eventsMode: 'light' });
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

  it('downgrades to off at start when the flag is flipped off after configuration (no stranded room)', async () => {
    const { code, host } = await readyRoom(t, { eventsMode: 'moderate' });
    // Simulate a maintainer flipping the server flag off between configure and start.
    const config = t.app.get(LobbyConfig) as { randomEvents: boolean };
    config.randomEvents = false;
    try {
      const started = await request(srv(t))
        .post(`/api/v1/rooms/${code}/start`)
        .set(auth(host.token))
        .expect(200);
      const snap = genesisSnapshot(t, started.body.gameId);
      expect(snap.gameSettings?.eventsMode).toBe('off');
      expect(snap.randomEvents).toBeUndefined();
    } finally {
      config.randomEvents = true; // restore for any later tests in this suite
    }
  });
});
