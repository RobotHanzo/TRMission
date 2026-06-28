import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { ServerEnvelope } from '@trm/proto';
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

async function startedRoom(patch?: object): Promise<{ code: string; gameId: string; host: { token: string; id: string } }> {
  const a = await guest('Host');
  const b = await guest('Player');
  const room = await request(server()).post('/api/v1/rooms').set(auth(a.token)).send({}).expect(201);
  const code: string = room.body.code;
  await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
  if (patch) {
    await request(server()).patch(`/api/v1/rooms/${code}/settings`).set(auth(a.token)).send(patch).expect(200);
  }
  await request(server()).post(`/api/v1/rooms/${code}/ready`).set(auth(a.token)).send({ ready: true }).expect(200);
  await request(server()).post(`/api/v1/rooms/${code}/ready`).set(auth(b.token)).send({ ready: true }).expect(200);
  const started = await request(server()).post(`/api/v1/rooms/${code}/start`).set(auth(a.token)).expect(200);
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
      encodeClient(1, { case: 'hello', value: { ticket: ticketRes.body.ticket, protocolVersion: 1 } }),
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
});
