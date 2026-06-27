// Builders for the ServerEnvelope.event oneof. The Connection wraps these with a
// per-socket server_seq + ack and encodes to binary, so these stay transport-free.
import type { MessageInitShape } from '@bufbuild/protobuf';
import type {
  GameSnapshot,
  GameEvent as PbGameEvent,
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

export const pongFrame = (nonce: number): ServerEvent => ({ case: 'pong', value: { nonce } });
