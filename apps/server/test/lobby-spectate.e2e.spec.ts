import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { RejectionCode, type ServerEnvelope } from '@trm/proto';
import { createTestApp, type TestApp } from './app';
import { GameHub } from '../src/ws/hub';
import { encodeClient, decodeServer } from './helpers';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function guest(displayName: string): Promise<{ token: string; id: string }> {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

async function startedRoom(
  patch?: object,
): Promise<{ code: string; gameId: string; host: { token: string; id: string } }> {
  const a = await guest('Host');
  const b = await guest('Player');
  const room = await request(server())
    .post('/api/v1/rooms')
    .set(auth(a.token))
    .send({})
    .expect(201);
  const code: string = room.body.code;
  await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
  if (patch) {
    await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(a.token))
      .send(patch)
      .expect(200);
  }
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
  return { code, gameId: started.body.gameId, host: a };
}

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);
afterAll(() => t.close());

describe('spectating', () => {
  it('admits a non-member spectator: snapshot with no SelfView, and commands are rejected', async () => {
    const { code } = await startedRoom();
    const s = await guest('Watcher');

    const ticketRes = await request(server())
      .post(`/api/v1/rooms/${code}/spectate`)
      .set(auth(s.token))
      .expect(200);
    expect(ticketRes.body.ticket).toBeTruthy();

    const hub = t.app.get(GameHub);
    const frames: ServerEnvelope[] = [];
    hub.openConnection('spec1', (bytes) => frames.push(decodeServer(bytes)));
    await hub.receive(
      'spec1',
      encodeClient(1, {
        case: 'hello',
        value: { ticket: ticketRes.body.ticket, protocolVersion: 1 },
      }),
    );

    const snap = frames.find((f) => f.event.case === 'snapshot');
    expect(frames.some((f) => f.event.case === 'welcome')).toBe(true);
    expect(snap).toBeTruthy();
    // Spectators never receive a SelfView.
    expect(snap!.event.case === 'snapshot' && snap!.event.value.snapshot?.you).toBeFalsy();

    // A spectator cannot act.
    frames.length = 0;
    await hub.receive('spec1', encodeClient(2, { case: 'drawBlind', value: {} }));
    expect(frames.some((f) => f.event.case === 'rejection')).toBe(true);
  });

  it('refuses a spectator ticket when the room disables spectating', async () => {
    const { code } = await startedRoom({ allowSpectating: false });
    const s = await guest('Blocked');
    await request(server()).post(`/api/v1/rooms/${code}/spectate`).set(auth(s.token)).expect(403);
  });

  it('records the spectator on the room doc when minting a spectate ticket', async () => {
    const { code } = await startedRoom();
    const s = await guest('Recorder');

    await request(server()).post(`/api/v1/rooms/${code}/spectate`).set(auth(s.token)).expect(200);

    const read = await request(server())
      .get(`/api/v1/rooms/${code}`)
      .set(auth(s.token))
      .expect(200);
    expect(read.body.spectators).toEqual([
      { userId: s.id, displayName: 'Recorder', isGuest: true },
    ]);

    // Minting a second ticket (e.g. a reconnect) doesn't duplicate the entry.
    await request(server()).post(`/api/v1/rooms/${code}/spectate`).set(auth(s.token)).expect(200);
    const read2 = await request(server())
      .get(`/api/v1/rooms/${code}`)
      .set(auth(s.token))
      .expect(200);
    expect(read2.body.spectators).toHaveLength(1);
  });
});

// F18: a host kick must actually exclude the target from this room going forward — before this
// fix, a kicked member (or, for a PUBLIC room, an unrelated stranger) could still mint a fresh
// spectate ticket for the started game with no exclusion check at all.
describe('kicked users are excluded from this room going forward', () => {
  it('bans a kicked LOBBY member: rejoin is refused immediately, spectating is refused once the game starts', async () => {
    const a = await guest('Alice2');
    const mallory = await guest('Mallory');
    const c = await guest('Carol');

    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(mallory.token)).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(c.token)).expect(200);

    await request(server())
      .post(`/api/v1/rooms/${code}/kick/${mallory.id}`)
      .set(auth(a.token))
      .expect(200);

    // Banned: cannot rejoin the still-LOBBY room.
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(mallory.token)).expect(403);

    await request(server())
      .post(`/api/v1/rooms/${code}/ready`)
      .set(auth(a.token))
      .send({ ready: true })
      .expect(200);
    await request(server())
      .post(`/api/v1/rooms/${code}/ready`)
      .set(auth(c.token))
      .send({ ready: true })
      .expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/start`).set(auth(a.token)).expect(200);

    // Still banned: the same account cannot mint a spectate ticket for the now-started game.
    await request(server())
      .post(`/api/v1/rooms/${code}/spectate`)
      .set(auth(mallory.token))
      .expect(403);

    // A never-kicked stranger can still spectate normally — the ban is scoped to Mallory only.
    const watcher = await guest('Watcher2');
    const ticket = await request(server())
      .post(`/api/v1/rooms/${code}/spectate`)
      .set(auth(watcher.token))
      .expect(200);
    expect(ticket.body.ticket).toBeTruthy();
  });

  it('lets the host kick a spectator of a LIVE game, dropping any live connection immediately', async () => {
    const a = await guest('Bob2');
    const b = await guest('Dana');
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
    await request(server()).post(`/api/v1/rooms/${code}/start`).set(auth(a.token)).expect(200);

    const spectator = await guest('Spectator3');
    const ticketRes = await request(server())
      .post(`/api/v1/rooms/${code}/spectate`)
      .set(auth(spectator.token))
      .expect(200);

    const hub = t.app.get(GameHub);
    const frames: ServerEnvelope[] = [];
    hub.openConnection('spec-kick', (bytes) => frames.push(decodeServer(bytes)));
    await hub.receive(
      'spec-kick',
      encodeClient(1, {
        case: 'hello',
        value: { ticket: ticketRes.body.ticket, protocolVersion: 1 },
      }),
    );
    expect(frames.some((f) => f.event.case === 'welcome')).toBe(true);

    // Previously refused outright while the room was STARTED ('game already started'); this is
    // the case the fix carves out — a live game's SPECTATOR now has a remedy.
    const kicked = await request(server())
      .post(`/api/v1/rooms/${code}/kick/${spectator.id}`)
      .set(auth(a.token))
      .expect(200);
    expect(kicked.body.spectators).toEqual([]);

    // The already-bound connection is dropped immediately, not just refused on its next hello.
    const rejection = frames.find((f) => f.event.case === 'rejection');
    expect(rejection).toBeTruthy();
    expect(rejection!.event.case === 'rejection' && rejection!.event.value.code).toBe(
      RejectionCode.UNAUTHENTICATED,
    );

    // And re-spectating (even with a freshly minted ticket) is now refused too.
    await request(server())
      .post(`/api/v1/rooms/${code}/spectate`)
      .set(auth(spectator.token))
      .expect(403);
  });
});
