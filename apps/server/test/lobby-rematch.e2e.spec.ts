import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { PlayerId } from '@trm/shared';
import { createTestApp, type TestApp } from './app';
import { GameHub } from '../src/ws/hub';
import { GameRegistry } from '../src/game/game-registry';
import { encodeClient, actionToCommand, pickAction } from './helpers';

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

describe('lobby: rematch vote', () => {
  it('lets a seated member cast and change an advisory rematch vote', async () => {
    const a = await guest('Ada');
    const b = await guest('Bo');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);

    const voted = await request(server())
      .post(`/api/v1/rooms/${code}/rematch-vote`)
      .set(auth(b.token))
      .send({ wantsRematch: true })
      .expect(200);
    const bMember = voted.body.members.find((m: { userId: string }) => m.userId === b.id);
    expect(bMember.wantsRematch).toBe(true);

    const changed = await request(server())
      .post(`/api/v1/rooms/${code}/rematch-vote`)
      .set(auth(b.token))
      .send({ wantsRematch: false })
      .expect(200);
    expect(
      changed.body.members.find((m: { userId: string }) => m.userId === b.id).wantsRematch,
    ).toBe(false);
  });

  it('rejects a vote from someone who is not a member of the room', async () => {
    const a = await guest('Ada2');
    const outsider = await guest('Out');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;

    await request(server())
      .post(`/api/v1/rooms/${code}/rematch-vote`)
      .set(auth(outsider.token))
      .send({ wantsRematch: true })
      .expect(403);
  });
});

describe('lobby: host rematch', () => {
  it('rejects rematch from a non-host, and before/while the game is unfinished', async () => {
    const a = await guest('Host1');
    const b = await guest('Guest1');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);

    // Still LOBBY — nothing to rematch.
    await request(server()).post(`/api/v1/rooms/${code}/rematch`).set(auth(a.token)).expect(400);

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
    await request(server()).post(`/api/v1/rooms/${code}/start`).set(auth(a.token)).expect(200);

    // A non-host can't rematch, even mid-game.
    await request(server()).post(`/api/v1/rooms/${code}/rematch`).set(auth(b.token)).expect(403);
    // The game is still LIVE — the host can't rematch yet either.
    await request(server()).post(`/api/v1/rooms/${code}/rematch`).set(auth(a.token)).expect(400);
  });

  it('plays a game to completion, rematches, and starts a fresh game in the same room', async () => {
    const a = await guest('Host2');
    const b = await guest('Guest2');
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
      [a.id]: { connId: 'rematch-a', ticket: started.body.ticket, seq: 0 },
      [b.id]: { connId: 'rematch-b', ticket: bTicket, seq: 0 },
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

    const rematched = await request(server())
      .post(`/api/v1/rooms/${code}/rematch`)
      .set(auth(a.token))
      .expect(200);
    expect(rematched.body.status).toBe('LOBBY');
    expect(rematched.body.gameId).toBeUndefined();
    expect(rematched.body.members.every((m: { ready: boolean }) => m.ready === false)).toBe(true);

    // A second rematch call is a clean no-op-turned-400, not a crash.
    await request(server()).post(`/api/v1/rooms/${code}/rematch`).set(auth(a.token)).expect(400);

    // The same room code plays a brand-new game.
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
    const restarted = await request(server())
      .post(`/api/v1/rooms/${code}/start`)
      .set(auth(a.token))
      .expect(200);
    expect(restarted.body.gameId).toBeTruthy();
    expect(restarted.body.gameId).not.toBe(gameId);
  });

  it('falls back to the durable game status when the match is no longer resident (e.g. after a restart)', async () => {
    const a = await guest('Host3');
    const b = await guest('Guest3');
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
    const registry = t.app.get(GameRegistry);
    const session = registry.get(gameId)!.session;
    const board = session.board;
    const conns: Record<string, { connId: string; ticket: string; seq: number }> = {
      [a.id]: { connId: 'restart-a', ticket: started.body.ticket, seq: 0 },
      [b.id]: { connId: 'restart-b', ticket: bTicket, seq: 0 },
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

    // Simulate a server restart wiping the in-memory registry. recordCompletion already
    // persisted status: 'COMPLETED' to Mongo during the loop above, so isGameOver's store
    // fallback must still let this rematch succeed.
    registry.remove(gameId);

    await request(server()).post(`/api/v1/rooms/${code}/rematch`).set(auth(a.token)).expect(200);
  });
});
