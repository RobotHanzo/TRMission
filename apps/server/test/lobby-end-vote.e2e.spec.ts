import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Phase, type ServerEnvelope } from '@trm/proto';
import { createTestApp, type TestApp } from './app';
import { decodeServer, encodeClient } from './helpers';
import { GameHub } from '../src/ws/hub';
import { GameRegistry } from '../src/game/game-registry';

interface Guest {
  token: string;
  id: string;
}

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function guest(displayName: string): Promise<Guest> {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

async function startRoom(label: string, playerCount: number) {
  const players = await Promise.all(
    Array.from({ length: playerCount }, (_, i) => guest(`${label}-${i}`)),
  );
  const host = players[0]!;
  const room = await request(server())
    .post('/api/v1/rooms')
    .set(auth(host.token))
    .send({ maxPlayers: playerCount })
    .expect(201);
  const code = room.body.code as string;

  for (const player of players.slice(1)) {
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(player.token)).expect(200);
  }
  for (const player of players) {
    await request(server())
      .post(`/api/v1/rooms/${code}/ready`)
      .set(auth(player.token))
      .send({ ready: true })
      .expect(200);
  }
  const started = await request(server())
    .post(`/api/v1/rooms/${code}/start`)
    .set(auth(host.token))
    .expect(200);

  return { code, players, gameId: started.body.gameId as string, hostTicket: started.body.ticket };
}

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);

afterAll(() => t.close());

describe('lobby: vote to end the active game', () => {
  it('lets the room host end immediately and broadcasts a scored GAME_OVER snapshot', async () => {
    const { code, players, gameId, hostTicket } = await startRoom('end-host', 3);
    const host = players[0]!;
    const hub = t.app.get(GameHub);
    const frames: ServerEnvelope[] = [];
    hub.openConnection('end-vote-host', (bytes) => frames.push(decodeServer(bytes)));
    await hub.receive(
      'end-vote-host',
      encodeClient(1, {
        case: 'hello',
        value: { ticket: hostTicket, protocolVersion: 1 },
      }),
    );

    const voted = await request(server())
      .post(`/api/v1/rooms/${code}/end-vote`)
      .set(auth(host.token))
      .send({ wantsEnd: true })
      .expect(200);

    expect(voted.body.members.find((m: { userId: string }) => m.userId === host.id).wantsEnd).toBe(
      true,
    );
    const session = t.app.get(GameRegistry).get(gameId)!.session;
    expect(session.phase).toBe('GAME_OVER');
    expect(session.raw().finalScores?.players).toHaveLength(3);
    expect(session.appliedActions.at(-1)).toEqual({ t: 'END_GAME', player: host.id });

    const finalSnapshot = [...frames].reverse().find((frame) => frame.event.case === 'snapshot');
    expect(finalSnapshot?.event.case).toBe('snapshot');
    if (finalSnapshot?.event.case !== 'snapshot') throw new Error('missing final snapshot');
    expect(finalSnapshot.event.value.snapshot?.phase).toBe(Phase.GAME_OVER);
    expect(finalSnapshot.event.value.snapshot?.finalScores?.players).toHaveLength(3);

    expect(await t.db.collection('games').findOne({ _id: gameId } as never)).toMatchObject({
      status: 'COMPLETED',
      currentSeq: 1,
      engineVersion: 10,
    });
    expect(await t.db.collection('gameEvents').findOne({ gameId, seq: 1 } as never)).toMatchObject({
      action: { t: 'END_GAME', player: host.id },
    });
    expect(await t.db.collection('matchHistory').findOne({ _id: gameId } as never)).toMatchObject({
      _id: gameId,
      engineVersion: 10,
    });

    // A completed game keeps its room in STARTED for the scoreboard/rematch flow, but neither a
    // yes nor a below-quorum false vote may be accepted after GAME_OVER.
    await request(server())
      .post(`/api/v1/rooms/${code}/end-vote`)
      .set(auth(players[1]!.token))
      .send({ wantsEnd: false })
      .expect(400);

    const rematched = await request(server())
      .post(`/api/v1/rooms/${code}/rematch`)
      .set(auth(host.token))
      .expect(200);
    expect(rematched.body.members.every((m: { wantsEnd?: boolean }) => m.wantsEnd === false)).toBe(
      true,
    );
  });

  it('supports retraction, requires all but one human yes votes, and recovers before ending', async () => {
    const { code, players, gameId } = await startRoom('end-threshold', 4);
    const registry = t.app.get(GameRegistry);

    const firstVoter = players[1]!;
    await request(server())
      .post(`/api/v1/rooms/${code}/end-vote`)
      .set(auth(firstVoter.token))
      .send({ wantsEnd: true })
      .expect(200);
    const retracted = await request(server())
      .post(`/api/v1/rooms/${code}/end-vote`)
      .set(auth(firstVoter.token))
      .send({ wantsEnd: false })
      .expect(200);
    expect(retracted.body.members.filter((m: { wantsEnd?: boolean }) => m.wantsEnd)).toHaveLength(
      0,
    );

    for (const voter of players.slice(2)) {
      await request(server())
        .post(`/api/v1/rooms/${code}/end-vote`)
        .set(auth(voter.token))
        .send({ wantsEnd: true })
        .expect(200);
    }
    expect(registry.get(gameId)!.session.phase).not.toBe('GAME_OVER');

    // Simulate process-memory loss before the deciding REST vote. endGame must rehydrate the
    // still-LIVE match from its durable genesis/action log, then append END_GAME normally. Stamp
    // that durable genesis as v9 too, pinning the live-v9 -> terminal-v10 migration path.
    await t.db
      .collection('gameSnapshots')
      .updateOne({ gameId, seq: 0 }, { $set: { 'state.engineVersion': 9 } });
    await t.db
      .collection('games')
      .updateOne({ _id: gameId } as never, { $set: { engineVersion: 9 } });
    registry.remove(gameId);
    expect(registry.get(gameId)).toBeUndefined();

    const decidingVoter = firstVoter;
    const decided = await request(server())
      .post(`/api/v1/rooms/${code}/end-vote`)
      .set(auth(decidingVoter.token))
      .send({ wantsEnd: true })
      .expect(200);

    expect(decided.body.members.filter((m: { wantsEnd?: boolean }) => m.wantsEnd).length).toBe(3);
    expect(registry.get(gameId)?.session.phase).toBe('GAME_OVER');
    expect(registry.get(gameId)?.session.raw().engineVersion).toBe(10);
    expect(await t.db.collection('games').findOne({ _id: gameId } as never)).toMatchObject({
      status: 'COMPLETED',
      currentSeq: 1,
      engineVersion: 10,
    });
  });

  it('excludes bot seats from the non-host quorum denominator', async () => {
    const host = await guest('end-bots-host');
    const human = await guest('end-bots-human');
    const created = await request(server())
      .post('/api/v1/rooms')
      .set(auth(host.token))
      .send({ maxPlayers: 4 })
      .expect(201);
    const code = created.body.code as string;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(human.token)).expect(200);
    for (const difficulty of ['EASY', 'MEDIUM']) {
      await request(server())
        .post(`/api/v1/rooms/${code}/bots`)
        .set(auth(host.token))
        .send({ difficulty })
        .expect(200);
    }
    for (const player of [host, human]) {
      await request(server())
        .post(`/api/v1/rooms/${code}/ready`)
        .set(auth(player.token))
        .send({ ready: true })
        .expect(200);
    }
    const started = await request(server())
      .post(`/api/v1/rooms/${code}/start`)
      .set(auth(host.token))
      .expect(200);

    // There are four seats but only two eligible humans, so the sole non-host human supplies the
    // required humanCount - 1 vote. Counting bots would incorrectly leave this game stuck.
    await request(server())
      .post(`/api/v1/rooms/${code}/end-vote`)
      .set(auth(human.token))
      .send({ wantsEnd: true })
      .expect(200);
    expect(t.app.get(GameRegistry).get(started.body.gameId)?.session.phase).toBe('GAME_OVER');
  });

  it('rejects votes outside an active game and from non-members', async () => {
    const host = await guest('end-invalid-host');
    const member = await guest('end-invalid-member');
    const outsider = await guest('end-invalid-outsider');
    const created = await request(server())
      .post('/api/v1/rooms')
      .set(auth(host.token))
      .send({})
      .expect(201);
    const code = created.body.code as string;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(member.token)).expect(200);

    await request(server())
      .post(`/api/v1/rooms/${code}/end-vote`)
      .set(auth(host.token))
      .send({ wantsEnd: true })
      .expect(400);

    for (const player of [host, member]) {
      await request(server())
        .post(`/api/v1/rooms/${code}/ready`)
        .set(auth(player.token))
        .send({ ready: true })
        .expect(200);
    }
    await request(server()).post(`/api/v1/rooms/${code}/start`).set(auth(host.token)).expect(200);

    await request(server())
      .post(`/api/v1/rooms/${code}/end-vote`)
      .set(auth(outsider.token))
      .send({ wantsEnd: true })
      .expect(403);
  });
});
