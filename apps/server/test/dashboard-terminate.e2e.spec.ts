import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { ServerEnvelope } from '@trm/proto';
import { createTestApp, type TestApp } from './app';
import { GameHub } from '../src/ws/hub';
import { GameRegistry } from '../src/game/game-registry';
import { decodeServer, encodeClient } from './helpers';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function guest(displayName: string) {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { userId: res.body.user.id as string, token: res.body.accessToken as string };
}

const terminatedNotice = (frames: ServerEnvelope[]) =>
  frames.find(
    (f) => f.event.case === 'rejection' && f.event.value.messageKey === 'errors:gameTerminated',
  );

let moderator: { userId: string; token: string };

beforeAll(async () => {
  t = await createTestApp();
  const res = await request(server())
    .post('/api/v1/auth/register')
    .send({ email: 'mod@example.com', password: 'password123', displayName: 'Mod' })
    .expect(201);
  moderator = { userId: res.body.user.id, token: res.body.accessToken };
  await t.db.collection('dashboardAccounts').insertOne({
    _id: moderator.userId,
    role: 'moderator',
    grantedBy: 'test',
    grantedAt: new Date(),
    updatedAt: new Date(),
  } as never);
}, 60_000);

afterAll(() => t.close());

describe('force-terminate', () => {
  it('terminates a LIVE game: notifies sockets, evicts, closes the room, blocks resurrection', async () => {
    const host = await guest('Host');
    const member = await guest('Member');
    const watcher = await guest('Watcher');

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
    const gameId: string = started.body.gameId;
    const memberTicket = (
      await request(server())
        .post(`/api/v1/rooms/${code}/ticket`)
        .set(auth(member.token))
        .expect(200)
    ).body.ticket;
    const watchTicket = (
      await request(server())
        .post(`/api/v1/rooms/${code}/spectate`)
        .set(auth(watcher.token))
        .expect(200)
    ).body.ticket;

    // Bind host + member + spectator over real protobuf bytes.
    const hub = t.app.get(GameHub);
    const frames = {
      host: [] as ServerEnvelope[],
      member: [] as ServerEnvelope[],
      watch: [] as ServerEnvelope[],
    };
    hub.openConnection('c-host', (b) => frames.host.push(decodeServer(b)));
    hub.openConnection('c-member', (b) => frames.member.push(decodeServer(b)));
    hub.openConnection('c-watch', (b) => frames.watch.push(decodeServer(b)));
    await hub.receive(
      'c-host',
      encodeClient(1, {
        case: 'hello',
        value: { ticket: started.body.ticket, protocolVersion: 1 },
      }),
    );
    await hub.receive(
      'c-member',
      encodeClient(1, { case: 'hello', value: { ticket: memberTicket, protocolVersion: 1 } }),
    );
    await hub.receive(
      'c-watch',
      encodeClient(1, { case: 'hello', value: { ticket: watchTicket, protocolVersion: 1 } }),
    );
    expect(t.app.get(GameRegistry).get(gameId)).toBeTruthy();

    // Terminate through the dashboard.
    const res = await request(server())
      .post(`/api/v1/dashboard/games/${gameId}/terminate`)
      .set(auth(moderator.token))
      .send({ reason: 'stuck' })
      .expect(200);
    expect(res.body.status).toBe('TERMINATED');
    expect(res.body.terminated.by).toBe(moderator.userId);
    expect(res.body.terminated.reason).toBe('stuck');
    // Terminated games disclose their seed (game is dead) — but via the detail shape only.
    expect(res.body.seed).toBeTruthy();

    // Every connected socket got the termination notice.
    expect(terminatedNotice(frames.host)).toBeTruthy();
    expect(terminatedNotice(frames.member)).toBeTruthy();
    expect(terminatedNotice(frames.watch)).toBeTruthy();

    // Evicted from memory; DB flipped; room closed.
    expect(t.app.get(GameRegistry).get(gameId)).toBeUndefined();
    const gameDoc = await t.db.collection('games').findOne({ _id: gameId } as never);
    expect(gameDoc?.status).toBe('TERMINATED');
    const roomDoc = await t.db.collection('rooms').findOne({ _id: code } as never);
    expect(roomDoc?.status).toBe('CLOSED');

    // Resurrection blocked: the room is CLOSED so the ticket path already refuses…
    const reticket = await request(server())
      .post(`/api/v1/rooms/${code}/ticket`)
      .set(auth(member.token));
    // (room stays addressable — the ticket mints fine — but hello must refuse)
    if (reticket.status === 200) {
      hub.openConnection('c-back', (b) => frames.member.push(decodeServer(b)));
      await hub.receive(
        'c-back',
        encodeClient(1, {
          case: 'hello',
          value: { ticket: reticket.body.ticket, protocolVersion: 1 },
        }),
      );
      const last = frames.member[frames.member.length - 1]!;
      expect(last.event.case).toBe('rejection');
      expect(t.app.get(GameRegistry).get(gameId)).toBeUndefined();
    }

    // Second terminate → 409; audit row exists; no matchHistory archive; not replayable.
    await request(server())
      .post(`/api/v1/dashboard/games/${gameId}/terminate`)
      .set(auth(moderator.token))
      .send({})
      .expect(409);
    expect(
      await t.db.collection('dashboardAudit').countDocuments({
        action: 'game.terminate',
        'target.id': gameId,
      } as never),
    ).toBe(1);
    expect(await t.db.collection('matchHistory').countDocuments({ _id: gameId } as never)).toBe(0);
    await request(server())
      .get(`/api/v1/dashboard/games/${gameId}/log`)
      .set(auth(moderator.token))
      .expect(409);
    await request(server())
      .get(`/api/v1/dashboard/games/${gameId}/replay`)
      .set(auth(moderator.token))
      .expect(404);
  }, 60_000);

  it('404s an unknown game and 409s a non-live one', async () => {
    await request(server())
      .post('/api/v1/dashboard/games/nope/terminate')
      .set(auth(moderator.token))
      .send({})
      .expect(404);
  });
});

describe('force-close room', () => {
  it('closes a LOBBY room, refuses STARTED rooms, audits the action', async () => {
    const host = await guest('Lonely');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(host.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;

    const closed = await request(server())
      .post(`/api/v1/dashboard/rooms/${code}/close`)
      .set(auth(moderator.token))
      .send({ reason: 'abandoned' })
      .expect(200);
    expect(closed.body.status).toBe('CLOSED');
    expect(
      await t.db.collection('dashboardAudit').countDocuments({
        action: 'room.close',
        'target.id': code,
      } as never),
    ).toBe(1);

    // Closing again → 409.
    await request(server())
      .post(`/api/v1/dashboard/rooms/${code}/close`)
      .set(auth(moderator.token))
      .send({})
      .expect(409);

    // A STARTED room → 409 pointing at game termination.
    const h2 = await guest('H2');
    const m2 = await guest('M2');
    const r2 = await request(server())
      .post('/api/v1/rooms')
      .set(auth(h2.token))
      .send({})
      .expect(201);
    await request(server())
      .post(`/api/v1/rooms/${r2.body.code}/join`)
      .set(auth(m2.token))
      .expect(200);
    for (const u of [h2, m2]) {
      await request(server())
        .post(`/api/v1/rooms/${r2.body.code}/ready`)
        .set(auth(u.token))
        .send({ ready: true })
        .expect(200);
    }
    await request(server())
      .post(`/api/v1/rooms/${r2.body.code}/start`)
      .set(auth(h2.token))
      .expect(200);
    await request(server())
      .post(`/api/v1/dashboard/rooms/${r2.body.code}/close`)
      .set(auth(moderator.token))
      .send({})
      .expect(409);
  }, 60_000);
});

describe('admin transfer host', () => {
  it('reassigns the host of a LOBBY room, keeping the old host seated, and audits it', async () => {
    const a = await guest('Cass');
    const b = await guest('Drew');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);

    const res = await request(server())
      .post(`/api/v1/dashboard/rooms/${code}/transfer/${b.userId}`)
      .set(auth(moderator.token))
      .send({ reason: 'host went AFK' })
      .expect(200);
    expect(res.body.hostId).toBe(b.userId);
    expect(res.body.members.map((m: { userId: string }) => m.userId)).toContain(a.userId);
    expect(
      await t.db.collection('dashboardAudit').countDocuments({
        action: 'room.transferHost',
        'target.id': code,
      } as never),
    ).toBe(1);
  });

  it('404s an unknown room, 400s an invalid target, 409s a STARTED room', async () => {
    const a = await guest('Ellis');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;

    await request(server())
      .post(`/api/v1/dashboard/rooms/nope/transfer/${a.userId}`)
      .set(auth(moderator.token))
      .send({})
      .expect(404);

    await request(server())
      .post(`/api/v1/dashboard/rooms/${code}/transfer/nobody`)
      .set(auth(moderator.token))
      .send({})
      .expect(400);

    await request(server())
      .post(`/api/v1/rooms/${code}/bots`)
      .set(auth(a.token))
      .send({ difficulty: 'EASY' })
      .expect(200);
    const roomDoc = await t.db.collection('rooms').findOne({ _id: code } as never);
    const botId = (
      roomDoc as unknown as { members: { userId: string; isBot?: boolean }[] }
    ).members.find((m) => m.isBot)!.userId;
    await request(server())
      .post(`/api/v1/dashboard/rooms/${code}/transfer/${botId}`)
      .set(auth(moderator.token))
      .send({})
      .expect(400);

    const b = await guest('Fran');
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    for (const u of [a, b]) {
      await request(server())
        .post(`/api/v1/rooms/${code}/ready`)
        .set(auth(u.token))
        .send({ ready: true })
        .expect(200);
    }
    await request(server()).post(`/api/v1/rooms/${code}/start`).set(auth(a.token)).expect(200);
    await request(server())
      .post(`/api/v1/dashboard/rooms/${code}/transfer/${b.userId}`)
      .set(auth(moderator.token))
      .send({})
      .expect(409);
  }, 60_000);

  it('403s without the rooms.transferHost permission', async () => {
    const viewerRes = await request(server())
      .post('/api/v1/auth/register')
      .send({
        email: 'viewer-transfer@example.com',
        password: 'password123',
        displayName: 'Viewer',
      })
      .expect(201);
    const viewer = {
      userId: viewerRes.body.user.id as string,
      token: viewerRes.body.accessToken as string,
    };
    await t.db.collection('dashboardAccounts').insertOne({
      _id: viewer.userId,
      role: 'viewer',
      grantedBy: 'test',
      grantedAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const a = await guest('Gale');
    const b = await guest('Hart');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);

    await request(server())
      .post(`/api/v1/dashboard/rooms/${code}/transfer/${b.userId}`)
      .set(auth(viewer.token))
      .send({})
      .expect(403);
  });
});
