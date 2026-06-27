import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, type RawData } from 'ws';
import { taiwanBoard, CONTENT_HASH, type PlayerSeed } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import type { ServerEnvelope } from '@trm/proto';
import { GameRegistry } from '../src/game/game-registry';
import { GameHub } from '../src/ws/hub';
import { attachWsServer } from '../src/ws/ws-server';
import { makeDevTicket } from '../src/ws/ticket';
import { encodeClient, decodeServer } from './helpers';

const listen = (server: Server): Promise<number> =>
  new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)),
  );

const toBytes = (data: RawData): Uint8Array =>
  Array.isArray(data)
    ? new Uint8Array(Buffer.concat(data))
    : new Uint8Array(Buffer.from(data as ArrayBuffer));

describe('real WebSocket transport', () => {
  it('completes the hello handshake and answers a ping over a real socket', async () => {
    const http = createServer();
    const hub = new GameHub(new GameRegistry());
    const players: PlayerSeed[] = [
      { id: asPlayerId('p1'), seat: 0 },
      { id: asPlayerId('p2'), seat: 1 },
    ];
    await hub.createMatch('sock', taiwanBoard(), {
      seed: 'sock-1',
      players,
      contentHash: CONTENT_HASH,
    });
    attachWsServer(http, hub, '/ws');
    const port = await listen(http);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const frames: ServerEnvelope[] = [];

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for frames')), 4000);
      ws.on('message', (data: RawData) => {
        frames.push(decodeServer(toBytes(data)));
        const cases = new Set(frames.map((f) => f.event.case));
        if (cases.has('welcome') && cases.has('snapshot') && cases.has('pong')) {
          clearTimeout(timer);
          resolve();
        }
      });
      ws.on('error', reject);
      ws.on('open', () => {
        ws.send(
          encodeClient(1, {
            case: 'hello',
            value: {
              ticket: makeDevTicket({ gameId: 'sock', playerId: 'p1', seat: 0 }),
              protocolVersion: 1,
            },
          }),
        );
        ws.send(encodeClient(2, { case: 'ping', value: { nonce: 42 } }));
      });
    });

    const welcome = frames.find((f) => f.event.case === 'welcome');
    if (welcome?.event.case !== 'welcome') throw new Error('no welcome');
    expect(welcome.event.value.playerId).toBe('p1');
    expect(welcome.event.value.gameId).toBe('sock');

    const snapshot = frames.find((f) => f.event.case === 'snapshot');
    if (snapshot?.event.case !== 'snapshot') throw new Error('no snapshot');
    expect(snapshot.event.value.snapshot?.you?.playerId).toBe('p1');

    const pong = frames.find((f) => f.event.case === 'pong');
    if (pong?.event.case !== 'pong') throw new Error('no pong');
    expect(pong.event.value.nonce).toBe(42);

    ws.close();
    await new Promise<void>((r) => http.close(() => r()));
  });
});
