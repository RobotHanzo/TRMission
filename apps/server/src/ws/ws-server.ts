// Thin glue between a raw `ws` server and the transport-agnostic GameHub. The hub
// holds all protocol logic; this file only moves bytes and manages socket lifecycle.
import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { Logger } from '@nestjs/common';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import type { GameHub } from './hub';

const log = new Logger('ws');

export function attachWsServer(
  httpServer: HttpServer,
  hub: GameHub,
  path = '/ws',
): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path });

  wss.on('connection', (socket: WebSocket) => {
    const id = randomUUID();
    hub.openConnection(
      id,
      (bytes) => {
        if (socket.readyState === socket.OPEN) socket.send(bytes);
      },
      (code, reason) => socket.close(code, reason),
    );

    socket.on('message', (data: RawData) => {
      // `hub.receive` handles its own errors; this catch is the last line of defence, because an
      // unhandled rejection here would take the whole server down with every other game on it.
      hub.receive(id, toUint8(data)).catch((err: unknown) => {
        log.error(`ws receive failed for ${id}: ${err instanceof Error ? err.message : err}`);
      });
    });
    socket.on('close', () => hub.closeConnection(id));
    socket.on('error', () => hub.closeConnection(id));
  });

  return wss;
}

function toUint8(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
