import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { PlayerId } from '@trm/shared';
import type { ServerEnvelope } from '@trm/proto';
import { createTestApp, type TestApp } from './app';
import { GameHub } from '../src/ws/hub';
import { GameRegistry } from '../src/game/game-registry';
import { encodeClient, decodeServer, actionToCommand, pickAction } from './helpers';

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

describe('lobby: room lifecycle + ws-ticket handoff', () => {
  it('creates/joins/readies/starts a room and mints a ticket the hub accepts', async () => {
    const a = await guest('Alice');
    const b = await guest('Bob');

    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    expect(room.body.members).toHaveLength(1);
    expect(room.body.hostId).toBe(a.id);

    const joined = await request(server())
      .post(`/api/v1/rooms/${code}/join`)
      .set(auth(b.token))
      .expect(200);
    expect(joined.body.members).toHaveLength(2);

    // Can't start until everyone is ready; only the host may start.
    await request(server()).post(`/api/v1/rooms/${code}/start`).set(auth(a.token)).expect(400);
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
    await request(server()).post(`/api/v1/rooms/${code}/start`).set(auth(b.token)).expect(403);

    const started = await request(server())
      .post(`/api/v1/rooms/${code}/start`)
      .set(auth(a.token))
      .expect(200);
    expect(started.body.gameId).toBeTruthy();
    expect(started.body.ticket).toBeTruthy();

    const bTicket = (
      await request(server()).post(`/api/v1/rooms/${code}/ticket`).set(auth(b.token)).expect(200)
    ).body;
    expect(bTicket.gameId).toBe(started.body.gameId);

    // The minted JWT ticket is redeemed by the hub for a socket (in-process hello).
    const hub = t.app.get(GameHub);
    const frames: ServerEnvelope[] = [];
    hub.openConnection('cB', (bytes) => frames.push(decodeServer(bytes)));
    await hub.receive(
      'cB',
      encodeClient(1, { case: 'hello', value: { ticket: bTicket.ticket, protocolVersion: 1 } }),
    );
    expect(frames.some((f) => f.event.case === 'welcome')).toBe(true);
    expect(frames.some((f) => f.event.case === 'snapshot')).toBe(true);
  });
});

describe('lobby: host kicks a player', () => {
  it('removes a member on host request, re-seats, and rejects non-host / self kicks', async () => {
    const a = await guest('Ada');
    const b = await guest('Ben');
    const c = await guest('Cy');

    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(c.token)).expect(200);

    // A non-host cannot kick anyone.
    await request(server())
      .post(`/api/v1/rooms/${code}/kick/${c.id}`)
      .set(auth(b.token))
      .expect(403);
    // The host cannot kick themselves.
    await request(server())
      .post(`/api/v1/rooms/${code}/kick/${a.id}`)
      .set(auth(a.token))
      .expect(400);

    const kicked = await request(server())
      .post(`/api/v1/rooms/${code}/kick/${b.id}`)
      .set(auth(a.token))
      .expect(200);
    expect(kicked.body.members.map((m: { userId: string }) => m.userId)).toEqual([a.id, c.id]);
    // Seats stay contiguous after the removal.
    expect(kicked.body.members.map((m: { seat: number }) => m.seat)).toEqual([0, 1]);
  });
});

describe('lobby → game → history (end to end)', () => {
  it('plays a started game to completion and archives it to match history', async () => {
    const a = await guest('Hana');
    const b = await guest('Kai');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
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
    const gameId: string = started.body.gameId;
    const bTicket = (
      await request(server()).post(`/api/v1/rooms/${code}/ticket`).set(auth(b.token)).expect(200)
    ).body.ticket;

    const hub = t.app.get(GameHub);
    const session = t.app.get(GameRegistry).get(gameId)!.session;
    const board = session.board;

    const conns: Record<string, { connId: string; ticket: string; seq: number }> = {
      [a.id]: { connId: 'a', ticket: started.body.ticket, seq: 0 },
      [b.id]: { connId: 'b', ticket: bTicket, seq: 0 },
    };
    for (const c of Object.values(conns)) {
      hub.openConnection(c.connId, () => {});
      await hub.receive(
        c.connId,
        encodeClient(++c.seq, { case: 'hello', value: { ticket: c.ticket, protocolVersion: 1 } }),
      );
    }

    let guard = 0;
    while (session.phase !== 'GAME_OVER') {
      if (++guard > 5000) throw new Error('game did not terminate');
      const state = session.raw();
      const actor =
        state.turn.phase === 'SETUP_TICKETS'
          ? session.turnOrder.find((p) => session.hasPendingOffer(p))
          : session.currentPlayer;
      if (!actor) throw new Error('no actor');
      const c = conns[actor as string];
      if (!c) throw new Error(`unknown actor ${actor}`);
      await hub.receive(
        c.connId,
        encodeClient(++c.seq, actionToCommand(pickAction(board, state, actor as PlayerId))),
      );
    }

    const list = await request(server()).get('/api/v1/history').set(auth(a.token)).expect(200);
    expect(list.body.some((g: { gameId: string }) => g.gameId === gameId)).toBe(true);

    const detail = await request(server())
      .get(`/api/v1/history/${gameId}`)
      .set(auth(a.token))
      .expect(200);
    expect(detail.body.finalScores.players).toHaveLength(2);
    expect(detail.body.winners.length).toBeGreaterThan(0);
    expect(detail.body.players).toHaveLength(2);
  });
});

describe('lobby: spectator leave + kick', () => {
  it('lets a demoted spectator leave without affecting the seated members', async () => {
    const a = await guest('Ivy');
    const b = await guest('Jax');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/watch`).set(auth(b.token)).expect(200);

    const left = await request(server())
      .post(`/api/v1/rooms/${code}/leave`)
      .set(auth(b.token))
      .expect(200);
    expect(left.body.spectators).toEqual([]);
    expect(left.body.members.map((m: { userId: string }) => m.userId)).toEqual([a.id]);
  });

  it('lets the host remove a spectator', async () => {
    const a = await guest('Kim');
    const b = await guest('Lee');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/watch`).set(auth(b.token)).expect(200);

    const kicked = await request(server())
      .post(`/api/v1/rooms/${code}/kick/${b.id}`)
      .set(auth(a.token))
      .expect(200);
    expect(kicked.body.spectators).toEqual([]);
  });
});

describe('lobby: host cannot spectate', () => {
  it('rejects the host demoting to spectator, but lets a non-host demote', async () => {
    const a = await guest('Ada');
    const b = await guest('Ben');
    const room = await request(server()).post('/api/v1/rooms').set(auth(a.token)).send({}).expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/watch`).set(auth(a.token)).expect(400); // host
    await request(server()).post(`/api/v1/rooms/${code}/watch`).set(auth(b.token)).expect(200); // non-host
  });

  it('rejects a seated player minting a spectate ticket for their own game', async () => {
    const a = await guest('Cid');
    const b = await guest('Dot');
    const room = await request(server()).post('/api/v1/rooms').set(auth(a.token)).send({}).expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/ready`).set(auth(a.token)).send({ ready: true }).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/ready`).set(auth(b.token)).send({ ready: true }).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/start`).set(auth(a.token)).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/spectate`).set(auth(a.token)).expect(403);
  });
});
