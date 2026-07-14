// Builders for the ServerEnvelope.event oneof. The Connection wraps these with a
// per-socket server_seq + ack and encodes to binary, so these stay transport-free.
import type { MessageInitShape } from '@bufbuild/protobuf';
import type {
  GameSnapshot,
  GameEvent as PbGameEvent,
  CameraView,
  RejectionCode,
  ServerEnvelopeSchema,
  ChatBroadcastSchema,
} from '@trm/proto';
import { PROTOCOL_VERSION } from '@trm/proto';

export type ServerEvent = NonNullable<MessageInitShape<typeof ServerEnvelopeSchema>['event']>;
/** Either free text or a preset id — the same discriminated shape ChatBroadcast/ChatEntry carry. */
export type ChatContent = NonNullable<MessageInitShape<typeof ChatBroadcastSchema>['content']>;

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

export const chatFrame = (playerId: string, content: ChatContent): ServerEvent => ({
  case: 'chat',
  value: { playerId, content },
});

// Ephemeral cosmetic relay of another member's camera framing (board-space). Not part
// of the authoritative snapshot; carries no hidden information.
export const cameraMovedFrame = (playerId: string, view: CameraView): ServerEvent => ({
  case: 'cameraMoved',
  value: { playerId, view },
});

// Ephemeral per-turn countdown: how long the player being timed has left before the server
// auto-plays a default action for them (issue #13). Cosmetic — never part of the authoritative
// snapshot or action log. remainingMs is a duration (the client counts down against its own clock);
// playerId "" with remainingMs 0 clears the countdown (a bot's turn, or the game ended).
export const turnTimerFrame = (
  playerId: string,
  remainingMs: number,
  totalMs: number,
): ServerEvent => ({
  case: 'turnTimer',
  value: { playerId, remainingMs, totalMs },
});

export const pongFrame = (nonce: number): ServerEvent => ({ case: 'pong', value: { nonce } });

// Cosmetic hub/session bookkeeping (a seated player's connection was confirmed lost, after a
// debounce grace window, or they returned) — never an engine action, never part of the
// deterministic action log.
export const playerConnectionChangedFrame = (
  playerId: string,
  connected: boolean,
): ServerEvent => ({
  case: 'playerConnectionChanged',
  value: { playerId, connected },
});

export interface ConnectionLogEntryInit {
  playerId: string;
  connected: boolean;
  afterEventIndex: number;
}

// One-shot backfill of the game's event history (already redacted) + persisted chat + the
// connection-change log, sent after the snapshot on (re)connect. The client routes this to the
// log/chat only.
export const historyReplayFrame = (
  events: PbGameEvent[],
  chat: readonly { playerId: string; content: ChatContent; ts: number }[],
  stateVersion: number,
  connectionLog: readonly ConnectionLogEntryInit[] = [],
): ServerEvent => ({
  case: 'history',
  value: {
    events,
    chat: chat.map((c) => ({ playerId: c.playerId, content: c.content, ts: BigInt(c.ts) })),
    stateVersion,
    connectionLog: connectionLog.map((c) => ({
      playerId: c.playerId,
      connected: c.connected,
      afterEventIndex: c.afterEventIndex,
    })),
  },
});
