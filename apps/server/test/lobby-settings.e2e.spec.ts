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
      eventsMode: 'moderate',
      allowSpectating: true,
      visibility: 'INVITE_ONLY',
      map: { source: 'official', mapId: 'taiwan' },
      soloWaitForHost: true,
    });
  });

  it('a solo room (host + bot) starting with soloWaitForHost stamps turnTimerDisabled on the game', async () => {
    const a = await guest('Solo');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server())
      .post(`/api/v1/rooms/${code}/bots`)
      .set(auth(a.token))
      .send({ difficulty: 'EASY' })
      .expect(200);
    await request(server())
      .post(`/api/v1/rooms/${code}/ready`)
      .set(auth(a.token))
      .send({ ready: true })
      .expect(200);
    const started = await request(server())
      .post(`/api/v1/rooms/${code}/start`)
      .set(auth(a.token))
      .expect(200);

    // The default-on solo setting reached the persisted game (recovery restores it from here).
    const doc = await t.db
      .collection('games')
      .findOne({ _id: started.body.gameId } as never, { projection: { matchOptions: 1 } });
    expect(doc?.matchOptions).toEqual({ turnTimerDisabled: true });
  });

  it('a multi-human room keeps its turn timer even with soloWaitForHost stored on', async () => {
    const a = await guest('H2H-A');
    const b = await guest('H2H-B');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    for (const u of [a, b]) {
      await request(server())
        .post(`/api/v1/rooms/${code}/ready`)
        .set(auth(u.token))
        .send({ ready: true })
        .expect(200);
    }
    const started = await request(server())
      .post(`/api/v1/rooms/${code}/start`)
      .set(auth(a.token))
      .expect(200);
    const doc = await t.db
      .collection('games')
      .findOne({ _id: started.body.gameId } as never, { projection: { matchOptions: 1 } });
    expect(doc?.matchOptions).toBeUndefined();
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

  it('excludes public STARTED rooms whose game is engine-incompatible or has an unresolvable map', async () => {
    const a = await guest('SpecHost');

    // Two human players, no bots: nothing auto-acts after start, so the game stays at genesis
    // and never re-stamps `engineVersion` out from under the test's DB mutation below (a bot
    // would move immediately at TRM_BOT_DELAY_MS=0 and reset it via the normal appendAction path).
    async function publicStartedRoom(): Promise<{ code: string; gameId: string }> {
      const partner = await guest('SpecGuest');
      const room = await request(server())
        .post('/api/v1/rooms')
        .set(auth(a.token))
        .send({})
        .expect(201);
      const code: string = room.body.code;
      await request(server())
        .patch(`/api/v1/rooms/${code}/settings`)
        .set(auth(a.token))
        .send({ visibility: 'PUBLIC' })
        .expect(200);
      await request(server())
        .post(`/api/v1/rooms/${code}/join`)
        .set(auth(partner.token))
        .expect(200);
      for (const u of [a, partner]) {
        await request(server())
          .post(`/api/v1/rooms/${code}/ready`)
          .set(auth(u.token))
          .send({ ready: true })
          .expect(200);
      }
      const started = await request(server())
        .post(`/api/v1/rooms/${code}/start`)
        .set(auth(a.token))
        .expect(200);
      return { code, gameId: started.body.gameId };
    }

    const badEngine = await publicStartedRoom();
    await t.db
      .collection('games')
      .updateOne({ _id: badEngine.gameId } as never, { $set: { engineVersion: 1 } });

    const badMap = await publicStartedRoom();
    await t.db
      .collection('games')
      .updateOne({ _id: badMap.gameId } as never, { $set: { contentHash: 'not-a-real-hash' } });

    const okRoom = await publicStartedRoom();

    const list = await request(server()).get('/api/v1/rooms/public').expect(200);
    const codes = (list.body as { code: string }[]).map((r) => r.code);
    expect(codes).not.toContain(badEngine.code);
    expect(codes).not.toContain(badMap.code);
    expect(codes).toContain(okRoom.code);
  });

  it('excludes a public STARTED room whose game already ended (never rematched)', async () => {
    const a = await guest('DoneHost');
    const b = await guest('DoneGuest');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(a.token))
      .send({ visibility: 'PUBLIC' })
      .expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    for (const u of [a, b]) {
      await request(server())
        .post(`/api/v1/rooms/${code}/ready`)
        .set(auth(u.token))
        .send({ ready: true })
        .expect(200);
    }
    const started = await request(server())
      .post(`/api/v1/rooms/${code}/start`)
      .set(auth(a.token))
      .expect(200);

    // A LIVE game is still watchable.
    const liveList = await request(server()).get('/api/v1/rooms/public').expect(200);
    expect((liveList.body as { code: string }[]).map((r) => r.code)).toContain(code);

    // The game ends but the room is never rematched, left, or closed — this used to leave a dead
    // "watchable" entry on the public listing forever.
    await t.db
      .collection('games')
      .updateOne({ _id: started.body.gameId } as never, { $set: { status: 'COMPLETED' } });

    const list = await request(server()).get('/api/v1/rooms/public').expect(200);
    expect((list.body as { code: string }[]).map((r) => r.code)).not.toContain(code);
  });

  it('excludes a public LOBBY room whose custom map selector has been deleted', async () => {
    const a = await guest('CustomHost');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(a.token))
      .send({ visibility: 'PUBLIC' })
      .expect(200);

    // Simulate a stale selector — the room was pointed at a custom draft that's since been
    // deleted. Written directly (bypassing the mapBuilder-gated settings PATCH, which only
    // matters for the write path) since this test targets the public-listing read filter.
    await t.db.collection('rooms').updateOne({ _id: code } as never, {
      $set: { 'settings.map': { source: 'custom', customMapId: 'missing-draft' } },
    });

    const list = await request(server()).get('/api/v1/rooms/public').expect(200);
    expect((list.body as { code: string }[]).map((r) => r.code)).not.toContain(code);

    // Restore a draft under that id — the room becomes resolvable again and reappears.
    await t.db.collection('customMaps').insertOne({
      _id: 'missing-draft',
      ownerId: a.id,
      nameZh: 'x',
      nameEn: 'x',
      revision: 1,
      draft: { cities: [], routes: [], tickets: [] },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    const list2 = await request(server()).get('/api/v1/rooms/public').expect(200);
    expect((list2.body as { code: string }[]).map((r) => r.code)).toContain(code);
  });
});
