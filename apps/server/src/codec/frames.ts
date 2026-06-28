// Builders for the ServerEnvelope.event oneof. The Connection wraps these with a
// per-socket server_seq + ack and encodes to binary, so these stay transport-free.
import type { MessageInitShape } from '@bufbuild/protobuf';
import type {
  GameSnapshot,
  GameEvent as PbGameEvent,
  CameraView,
  RejectionCode,
  ServerEnvelopeSchema,
} from '@trm/proto';
import { PROTOCOL_VERSION } from '@trm/proto';


export type ServerEvent = NonNullable<MessageInitShape<typeof ServerEnvelopeSchema>['event']>;

export const welcomeFrame = (gameId: string, playerId: string, seat: number): ServerEvent => ({
  case: 'welcome',
  value: { gameId, playerId, seat, protocolVersion: PROTOCOL_VERSION },
});

export const snapshotFrame = (snapshot: GameSnapshot): ServerEvent => ({
  case: 'snapshot',
  value: { snapshot },
});

export const eventsFrame = (stateVersion: number, events: PbGameEvent[]): ServerEvent => ({
  case: 'events',
  value: { stateVersion, events },
});

export const rejectionFrame = (
  ackClientSeq: number,
  code: RejectionCode,
  messageKey: string,
  message: string,
): ServerEvent => ({
  case: 'rejection',
  value: { ackClientSeq, code, messageKey, message },
});

export const chatFrame = (playerId: string, text: string): ServerEvent => ({
  case: 'chat',
  value: { playerId, text },
});

// Ephemeral cosmetic relay of another member's camera framing (board-space). Not part
// of the authoritative snapshot; carries no hidden information.
export const cameraMovedFrame = (playerId: string, view: CameraView): ServerEvent => ({
  case: 'cameraMoved',
  value: { playerId, view },
});

export const pongFrame = (nonce: number): ServerEvent => ({ case: 'pong', value: { nonce } });

// One-shot backfill of the game's event history (already redacted) + persisted chat,
// sent after the snapshot on (re)connect. The client routes this to the log/chat only.
export const historyReplayFrame = (
  events: PbGameEvent[],
  chat: readonly { playerId: string; text: string; ts: number }[],
  stateVersion: number,
): ServerEvent => ({
  case: 'history',
  value: {
    events,
    chat: chat.map((c) => ({ playerId: c.playerId, text: c.text, ts: BigInt(c.ts) })),
    stateVersion,
  },
});
