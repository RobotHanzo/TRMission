import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';
import { GameRegistry } from '../src/game/game-registry';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function guest(displayName: string) {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { userId: res.body.user.id as string, token: res.body.accessToken as string };
}

/** Host + one member start a LIVE game. Returns the room code and gameId. */
async function startGame(hostName: string, memberName: string) {
  const host = await guest(hostName);
  const member = await guest(memberName);
  const room = await request(server())
    .post('/api/v1/rooms')
    .set(auth(host.token))
    .send({})
    .expect(201);
  const code: string = room.body.code;
  await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(member.token)).expect(200);
  for (const u of [host, member]) {
    await request(server())
      .post(`/api/v1/rooms/${code}/ready`)
      .set(auth(u.token))
      .send({ ready: true })
      .expect(200);
  }
  const started = await request(server())
    .post(`/api/v1/rooms/${code}/start`)
    .set(auth(host.token))
    .expect(200);
  return { code, gameId: started.body.gameId as string, host, member };
}

/** Used by the purge-sweep tests below to simulate an idle LIVE game/LOBBY room. */
async function backdateGame(gameId: string, hoursAgo: number) {
  await t.db.collection('games').updateOne({ _id: gameId } as never, {
    $set: { updatedAt: new Date(Date.now() - hoursAgo * 3_600_000) },
  });
}
async function backdateRoom(code: string, hoursAgo: number) {
  await t.db.collection('rooms').updateOne({ _id: code } as never, {
    $set: { updatedAt: new Date(Date.now() - hoursAgo * 3_600_000) },
  });
}

let admin: { userId: string; token: string };
let moderator: { userId: string; token: string };

beforeAll(async () => {
  t = await createTestApp();
  const adminRes = await request(server())
    .post('/api/v1/auth/register')
    .send({ email: 'admin@example.com', password: 'password123', displayName: 'Admin' })
    .expect(201);
  admin = { userId: adminRes.body.user.id, token: adminRes.body.accessToken };
  await t.db.collection('dashboardAccounts').insertOne({
    _id: admin.userId,
    role: 'admin',
    grantedBy: 'test',
    grantedAt: new Date(),
    updatedAt: new Date(),
  } as never);

  const modRes = await request(server())
    .post('/api/v1/auth/register')
    .send({ email: 'mod@example.com', password: 'password123', displayName: 'Mod' })
    .expect(201);
  moderator = { userId: modRes.body.user.id, token: modRes.body.accessToken };
  await t.db.collection('dashboardAccounts').insertOne({
    _id: moderator.userId,
    role: 'moderator',
    grantedBy: 'test',
    grantedAt: new Date(),
    updatedAt: new Date(),
  } as never);
}, 60_000);

afterAll(() => t.close());

describe('delete game', () => {
  it('403s a moderator (admin-tier permission)', async () => {
    const { gameId } = await startGame('H1', 'M1');
    await request(server())
      .delete(`/api/v1/dashboard/games/${gameId}`)
      .set(auth(moderator.token))
      .send({})
      .expect(403);
  });

  it('deletes a LIVE game: terminates, evicts, closes its room, hard-deletes all collections', async () => {
    const { code, gameId } = await startGame('H2', 'M2');
    expect(t.app.get(GameRegistry).get(gameId)).toBeTruthy();

    await request(server())
      .delete(`/api/v1/dashboard/games/${gameId}`)
      .set(auth(admin.token))
      .send({ reason: 'cleanup' })
      .expect(204);

    expect(t.app.get(GameRegistry).get(gameId)).toBeUndefined();
    expect(await t.db.collection('games').findOne({ _id: gameId } as never)).toBeNull();
    expect(await t.db.collection('gameEvents').countDocuments({ gameId } as never)).toBe(0);
    expect(await t.db.collection('gameSnapshots').countDocuments({ gameId } as never)).toBe(0);
    expect(await t.db.collection('gameChats').countDocuments({ gameId } as never)).toBe(0);
    const roomDoc = await t.db.collection('rooms').findOne({ _id: code } as never);
    expect(roomDoc?.status).toBe('CLOSED');
    expect(
      await t.db
        .collection('dashboardAudit')
        .countDocuments({ action: 'game.delete', 'target.id': gameId } as never),
    ).toBe(1);
  });

  it('deletes a COMPLETED game that is still hub-resident (natural completion never evicts)', async () => {
    const { gameId } = await startGame('H3', 'M3');
    // Simulate natural completion without playing a full game out: the hub never evicts on
    // its own natural-completion path (hub.ts), so the match stays registered exactly like a
    // real finished game would.
    await t.db.collection('games').updateOne({ _id: gameId } as never, {
      $set: { status: 'COMPLETED', updatedAt: new Date() },
    });
    expect(t.app.get(GameRegistry).get(gameId)).toBeTruthy();

    await request(server())
      .delete(`/api/v1/dashboard/games/${gameId}`)
      .set(auth(admin.token))
      .send({})
      .expect(204);

    expect(t.app.get(GameRegistry).get(gameId)).toBeUndefined();
    expect(await t.db.collection('games').findOne({ _id: gameId } as never)).toBeNull();
  });

  it('404s an unknown game', async () => {
    await request(server())
      .delete('/api/v1/dashboard/games/nope')
      .set(auth(admin.token))
      .send({})
      .expect(404);
  });
});

describe('delete room', () => {
  it('403s a moderator (admin-tier permission)', async () => {
    const host = await guest('H4');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(host.token))
      .send({})
      .expect(201);
    await request(server())
      .delete(`/api/v1/dashboard/rooms/${room.body.code}`)
      .set(auth(moderator.token))
      .send({})
      .expect(403);
  });

  it('deletes a LOBBY room', async () => {
    const host = await guest('H5');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(host.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;

    await request(server())
      .delete(`/api/v1/dashboard/rooms/${code}`)
      .set(auth(admin.token))
      .send({ reason: 'cleanup' })
      .expect(204);

    expect(await t.db.collection('rooms').findOne({ _id: code } as never)).toBeNull();
    expect(
      await t.db
        .collection('dashboardAudit')
        .countDocuments({ action: 'room.delete', 'target.id': code } as never),
    ).toBe(1);
  });

  it('deletes a STARTED room with a LIVE game: terminates the game (record kept), deletes only the room', async () => {
    const { code, gameId } = await startGame('H6', 'M6');

    await request(server())
      .delete(`/api/v1/dashboard/rooms/${code}`)
      .set(auth(admin.token))
      .send({})
      .expect(204);

    expect(await t.db.collection('rooms').findOne({ _id: code } as never)).toBeNull();
    const gameDoc = await t.db.collection('games').findOne({ _id: gameId } as never);
    expect(gameDoc?.status).toBe('TERMINATED');
    expect(t.app.get(GameRegistry).get(gameId)).toBeUndefined();
  });

  it('deletes a STARTED room whose linked game is already COMPLETED: room gone, game untouched', async () => {
    const { code, gameId } = await startGame('H7', 'M7');
    await t.db
      .collection('games')
      .updateOne({ _id: gameId } as never, {
        $set: { status: 'COMPLETED', updatedAt: new Date() },
      });

    await request(server())
      .delete(`/api/v1/dashboard/rooms/${code}`)
      .set(auth(admin.token))
      .send({})
      .expect(204);

    expect(await t.db.collection('rooms').findOne({ _id: code } as never)).toBeNull();
    const gameDoc = await t.db.collection('games').findOne({ _id: gameId } as never);
    expect(gameDoc?.status).toBe('COMPLETED'); // untouched — not deleted, not re-terminated
  });

  it('deletes a STARTED room whose linked game no longer exists (orphan)', async () => {
    const host = await guest('H8');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(host.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await t.db
      .collection('rooms')
      .updateOne({ _id: code } as never, {
        $set: { status: 'STARTED', gameId: 'ghost-game-id', updatedAt: new Date() },
      });

    await request(server())
      .delete(`/api/v1/dashboard/rooms/${code}`)
      .set(auth(admin.token))
      .send({})
      .expect(204);

    expect(await t.db.collection('rooms').findOne({ _id: code } as never)).toBeNull();
  });

  it('404s an unknown room', async () => {
    await request(server())
      .delete('/api/v1/dashboard/rooms/NOPE1')
      .set(auth(admin.token))
      .send({})
      .expect(404);
  });
});

describe('purge sweep + status', () => {
  it('403s a moderator on run and status (admin-tier permissions)', async () => {
    await request(server())
      .post('/api/v1/dashboard/purge/run')
      .set(auth(moderator.token))
      .send({})
      .expect(403);
    await request(server())
      .get('/api/v1/dashboard/purge/status')
      .set(auth(moderator.token))
      .expect(403);
  });

  it('returns config + thresholds from status', async () => {
    const res = await request(server())
      .get('/api/v1/dashboard/purge/status')
      .set(auth(admin.token))
      .expect(200);
    expect(res.body.autoEnabled).toBe(false);
    expect(typeof res.body.intervalMs).toBe('number');
    expect(typeof res.body.roomLobbyPurgeHours).toBe('number');
    expect(typeof res.body.gameLivePurgeHours).toBe('number');
    expect(Array.isArray(res.body.recentRuns)).toBe(true);
  });

  it(
    'purges a stale LOBBY room, a stale LIVE game (closing but not deleting its room), and a ' +
      'STARTED room whose game finished long ago — leaves fresh ones alone',
    async () => {
      // Stale LOBBY room (> 24h default threshold) vs. a fresh one.
      const staleLobbyHost = await guest('SL');
      const staleLobby = await request(server())
        .post('/api/v1/rooms')
        .set(auth(staleLobbyHost.token))
        .send({})
        .expect(201);
      await backdateRoom(staleLobby.body.code, 30);
      const freshLobbyHost = await guest('FL');
      const freshLobby = await request(server())
        .post('/api/v1/rooms')
        .set(auth(freshLobbyHost.token))
        .send({})
        .expect(201);

      // Stale LIVE game (> 168h default threshold) vs. a fresh one.
      const stale = await startGame('SG-H', 'SG-M');
      await backdateGame(stale.gameId, 200);
      const fresh = await startGame('FG-H', 'FG-M');

      // STARTED room whose game finished normally long ago and was never rematched — the
      // key gap this feature exists to close (see the design doc's finding).
      const finished = await startGame('DG-H', 'DG-M');
      await t.db
        .collection('games')
        .updateOne({ _id: finished.gameId } as never, {
          $set: { status: 'COMPLETED', updatedAt: new Date(Date.now() - 200 * 3_600_000) },
        });

      const res = await request(server())
        .post('/api/v1/dashboard/purge/run')
        .set(auth(admin.token))
        .expect(200);
      expect(res.body.roomsDeleted).toBe(2); // staleLobby + finished's room
      expect(res.body.gamesDeleted).toBe(1); // stale LIVE game
      expect(res.body.capped).toBe(false);

      // Stale LOBBY room: gone. Fresh LOBBY room: untouched.
      expect(
        await t.db.collection('rooms').findOne({ _id: staleLobby.body.code } as never),
      ).toBeNull();
      expect(
        await t.db.collection('rooms').findOne({ _id: freshLobby.body.code } as never),
      ).not.toBeNull();

      // Stale LIVE game: deleted; its room is CLOSED but NOT deleted (non-goal: terminal
      // records produced as a side effect of a sweep are left for manual cleanup).
      expect(await t.db.collection('games').findOne({ _id: stale.gameId } as never)).toBeNull();
      const staleRoom = await t.db.collection('rooms').findOne({ _id: stale.code } as never);
      expect(staleRoom?.status).toBe('CLOSED');
      // Fresh LIVE game: untouched.
      expect(await t.db.collection('games').findOne({ _id: fresh.gameId } as never)).not.toBeNull();

      // Finished-long-ago room: deleted; its COMPLETED game record is left alone.
      expect(await t.db.collection('rooms').findOne({ _id: finished.code } as never)).toBeNull();
      const finishedGame = await t.db
        .collection('games')
        .findOne({ _id: finished.gameId } as never);
      expect(finishedGame?.status).toBe('COMPLETED');

      // Exactly one purge.run audit entry, attributed to the admin who triggered it.
      const auditEntries = await t.db
        .collection('dashboardAudit')
        .find({ action: 'purge.run' } as never)
        .toArray();
      expect(auditEntries.length).toBe(1);
      expect((auditEntries[0] as unknown as { actorId: string }).actorId).toBe(admin.userId);

      // Recent-runs now shows it.
      const status = await request(server())
        .get('/api/v1/dashboard/purge/status')
        .set(auth(admin.token))
        .expect(200);
      expect(status.body.recentRuns.length).toBeGreaterThanOrEqual(1);
      expect(status.body.recentRuns[0].roomsDeleted).toBe(res.body.roomsDeleted);
    },
    60_000,
  );

  it('caps a sweep at 500 rooms per run and reports capped:true', async () => {
    const stale = new Date(Date.now() - 30 * 3_600_000);
    const docs = Array.from({ length: 501 }, (_, i) => ({
      _id: `CAP${i}`,
      hostId: 'nobody',
      status: 'LOBBY',
      members: [],
      maxPlayers: 5,
      settings: {},
      createdAt: stale,
      updatedAt: stale,
    }));
    await t.db.collection('rooms').insertMany(docs as never);

    const res = await request(server())
      .post('/api/v1/dashboard/purge/run')
      .set(auth(admin.token))
      .expect(200);
    expect(res.body.capped).toBe(true);
    expect(res.body.roomsDeleted).toBe(500);

    const remaining = await t.db
      .collection('rooms')
      .countDocuments({ _id: { $regex: /^CAP/ } } as never);
    expect(remaining).toBe(1);
  }, 30_000);
});
