// F19: RoomRepo.leave/kick/becomeSpectator are CAS-guarded on room status (mirroring
// join/addBot/becomePlayer), leave() no-ops for a non-member, and LobbyService.ticket() derives
// the actual seat from the engine's frozen turnOrder instead of the mutable room doc — while
// still rejecting a true non-member instantly, with zero hub/engine recovery interaction.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { ServerEnvelope } from '@trm/proto';
import { createTestApp, type TestApp } from './app';
import { GameHub } from '../src/ws/hub';
import { RoomRepo, type RoomDoc } from '../src/lobby/room.repo';
import { decodeServer, encodeClient } from './helpers';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function guest(displayName: string): Promise<{ token: string; id: string }> {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

async function ready(code: string, token: string) {
  await request(server())
    .post(`/api/v1/rooms/${code}/ready`)
    .set(auth(token))
    .send({ ready: true })
    .expect(200);
}

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);

afterAll(() => t.close());

describe('RoomRepo: leave/kick/becomeSpectator are CAS-guarded on room status', () => {
  it('leave() no-ops for a caller who was never a member or spectator of the room', async () => {
    const a = await guest('CAS-Host');
    const outsider = await guest('CAS-Outsider');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;

    const left = await request(server())
      .post(`/api/v1/rooms/${code}/leave`)
      .set(auth(outsider.token))
      .expect(200);
    expect(left.body.members.map((m: { userId: string }) => m.userId)).toEqual([a.id]);
    expect(left.body.status).toBe('LOBBY');
  });

  it('does not lose either departure when two members leave concurrently (no clobbered members array)', async () => {
    const a = await guest('CAS-Race-Host');
    const b = await guest('CAS-Race-B');
    const c = await guest('CAS-Race-C');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(c.token)).expect(200);

    const repo = t.app.get(RoomRepo);
    // Two concurrent leaves, no external synchronization — without a CAS-guarded retry loop, one
    // whole-array `$set` clobbers the other (a classic lost update), leaving one of {b, c} stuck
    // in `members` despite having "successfully" left.
    await Promise.all([repo.leave(code, b.id), repo.leave(code, c.id)]);

    const final = await repo.get(code);
    expect(final?.members.map((m) => m.userId)).toEqual([a.id]);
    expect(final?.members.map((m) => m.seat)).toEqual([0]);
  });

  it('never lets a leave that read a LOBBY room land its write after a concurrent start freezes it STARTED', async () => {
    const a = await guest('CAS-StartRace-Host');
    const b = await guest('CAS-StartRace-B');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);

    const repo = t.app.get(RoomRepo);
    // Reach into the repo's own Mongo collection handle (same technique as other specs' `t.db`
    // pokes) so we can inject a concurrent `markStarted` right after `leave`'s own read — the
    // exact interleaving F19 describes: `leave` decides "proceed" against a LOBBY snapshot, but a
    // concurrent host start commits and freezes the engine's seat assignment before `leave`'s
    // write lands.
    const col = (repo as unknown as { col: unknown }).col;
    const proto = Object.getPrototypeOf(col) as {
      findOne: (...args: unknown[]) => Promise<RoomDoc | null>;
    };
    const originalFindOne = proto.findOne;
    let triggered = false;
    const spy = vi.spyOn(proto, 'findOne').mockImplementation(async function (
      this: unknown,
      ...args: unknown[]
    ): Promise<RoomDoc | null> {
      const result = await originalFindOne.apply(this, args);
      if (!triggered && result?._id === code && result?.status === 'LOBBY') {
        triggered = true;
        await repo.markStarted(code, a.id, 'race-game-id', 'race-seed');
      }
      return result;
    });

    try {
      // gameIsOver=false: from the caller's perspective this is a live game, not a finished one.
      const result = await repo.leave(code, b.id, false);
      expect(result?.status).toBe('STARTED');
      expect(result?.members.map((m) => m.userId)).toEqual([a.id, b.id]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('LobbyService.ticket(): seat comes from the engine, membership comes from a cheap local gate', () => {
  it('rejects a non-member instantly with zero hub/engine interaction, and still mints a real member a working ticket', async () => {
    const a = await guest('Gate-Host');
    const b = await guest('Gate-Member');
    const outsider = await guest('Gate-Outsider');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await ready(code, a.token);
    await ready(code, b.token);
    const started = await request(server())
      .post(`/api/v1/rooms/${code}/start`)
      .set(auth(a.token))
      .expect(200);

    const hub = t.app.get(GameHub);
    const seatOfSpy = vi.spyOn(hub, 'seatOf');
    try {
      // Never a member of this room at all — must be rejected with NO call into hub.seatOf (which
      // recovers the match from durable storage when it isn't resident: expensive, and must never
      // be forceable on demand against an arbitrary room code by an outsider).
      await request(server())
        .post(`/api/v1/rooms/${code}/ticket`)
        .set(auth(outsider.token))
        .expect(403);
      expect(seatOfSpy).not.toHaveBeenCalled();

      // A genuine member's ticket still works, and now goes through the engine for the seat.
      const bTicket = await request(server())
        .post(`/api/v1/rooms/${code}/ticket`)
        .set(auth(b.token))
        .expect(200);
      expect(bTicket.body.gameId).toBe(started.body.gameId);
      expect(seatOfSpy).toHaveBeenCalledTimes(1);
    } finally {
      seatOfSpy.mockRestore();
    }
  });

  it('mints a ticket using the engine seat, not a seat renumbered by a gameIsOver leave', async () => {
    const a = await guest('Seat-Host');
    const b = await guest('Seat-Mid');
    const c = await guest('Seat-Last');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(c.token)).expect(200);
    await ready(code, a.token);
    await ready(code, b.token);
    await ready(code, c.token);
    await request(server()).post(`/api/v1/rooms/${code}/start`).set(auth(a.token)).expect(200);

    // The host's affirmative end-vote ends the game immediately.
    await request(server())
      .post(`/api/v1/rooms/${code}/end-vote`)
      .set(auth(a.token))
      .send({ wantsEnd: true })
      .expect(200);

    // b (seat 1) leaves the now-finished game. RoomRepo.leave renumbers the ROOM DOC's remaining
    // members contiguously, dropping c from seat 2 to seat 1 there — but the engine's frozen
    // turnOrder still has c seated at 2.
    const afterLeave = await request(server())
      .post(`/api/v1/rooms/${code}/leave`)
      .set(auth(b.token))
      .expect(200);
    expect(afterLeave.body.members.find((m: { userId: string }) => m.userId === c.id).seat).toBe(1);

    const cTicket = (
      await request(server()).post(`/api/v1/rooms/${code}/ticket`).set(auth(c.token)).expect(200)
    ).body.ticket;

    // Redeem the ticket for real: the hub independently checks the engine's own seatOf against the
    // ticket's seat and rejects a mismatch ('not a seat in this game') — so if `ticket()` had used
    // the stale, renumbered room-doc seat (1) instead of the engine's real seat (2), this hello
    // would be rejected instead of welcomed.
    const hub = t.app.get(GameHub);
    const frames: ServerEnvelope[] = [];
    hub.openConnection('seat-c', (bytes) => frames.push(decodeServer(bytes)));
    await hub.receive(
      'seat-c',
      encodeClient(1, { case: 'hello', value: { ticket: cTicket, protocolVersion: 1 } }),
    );
    expect(frames.some((f) => f.event.case === 'welcome')).toBe(true);
    expect(frames.some((f) => f.event.case === 'rejection')).toBe(false);
  });
});
