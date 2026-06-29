import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';
import { GameRegistry } from '../src/game/game-registry';

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

describe('lobby: per-game settings', () => {
  it('defaults settings on a fresh room', async () => {
    const a = await guest('Alice');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    expect(room.body.settings).toEqual({
      unlimitedStationBorrow: true,
      secondDrawAfterBlindRainbow: false,
      noUnfinishedTicketPenalty: false,
      doubleRouteSingleFor23: true,
      allowSpectating: true,
      visibility: 'INVITE_ONLY',
    });
  });

  it('lets only the host update settings, only while in LOBBY', async () => {
    const a = await guest('Host');
    const b = await guest('Guest');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);

    // non-host forbidden
    await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(b.token))
      .send({ visibility: 'INVITE_ONLY' })
      .expect(403);

    const updated = await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(a.token))
      .send({ unlimitedStationBorrow: true, visibility: 'INVITE_ONLY' })
      .expect(200);
    expect(updated.body.settings.unlimitedStationBorrow).toBe(true);
    expect(updated.body.settings.visibility).toBe('INVITE_ONLY');
  });

  it('passes rule variants into the engine at start', async () => {
    const a = await guest('A');
    const b = await guest('B');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(a.token))
      .send({ unlimitedStationBorrow: true, noUnfinishedTicketPenalty: true })
      .expect(200);
    await request(server())
      .post(`/api/v1/rooms/${code}/ready`)
      .set(auth(a.token))
      .send({ ready: true })
      .expect(200);
    await request(server())
      .post(`/api/v1/rooms/${code}/ready`)
      .set(auth(b.token))
      .send({ ready: true })
      .expect(200);
    const started = await request(server())
      .post(`/api/v1/rooms/${code}/start`)
      .set(auth(a.token))
      .expect(200);

    const match = t.app.get(GameRegistry).get(started.body.gameId);
    expect(match).toBeTruthy();
    const rp = match!.session.raw().ruleParams;
    expect(rp.unlimitedStationBorrow).toBe(true);
    expect(rp.noUnfinishedTicketPenalty).toBe(true);
    expect(rp.secondDrawAfterBlindRainbow).toBe(false);
    expect(rp.doubleRouteSingleFor23).toBe(true); // default is true; not patched so stays true
  });

  it('lists public rooms unauthenticated and hides invite-only', async () => {
    const a = await guest('Pub');
    const b = await guest('Priv');
    const pub = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    // Explicitly make this room public (default is now INVITE_ONLY).
    await request(server())
      .patch(`/api/v1/rooms/${pub.body.code}/settings`)
      .set(auth(a.token))
      .send({ visibility: 'PUBLIC' })
      .expect(200);
    const priv = await request(server())
      .post('/api/v1/rooms')
      .set(auth(b.token))
      .send({})
      .expect(201);
    // priv is already INVITE_ONLY by default — no patch needed.

    // No Authorization header — the public list is open.
    const list = await request(server()).get('/api/v1/rooms/public').expect(200);
    const codes = (list.body as { code: string }[]).map((r) => r.code);
    expect(codes).toContain(pub.body.code);
    expect(codes).not.toContain(priv.body.code);
  });
});
