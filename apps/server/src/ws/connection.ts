// A single client socket. Owns the outbound server_seq and the idempotency cursor
// (highest client_seq already processed, A7). Transport-agnostic: `sink` is just a
// byte writer, so the dispatcher can be exercised in-process with zero network.
import { create, toBinary } from '@bufbuild/protobuf';
import { ServerEnvelopeSchema } from '@trm/proto';
import type { PlayerId } from '@trm/shared';
import type { ServerEvent } from '@trm/codec';

export type Sink = (bytes: Uint8Array) => void;

export interface ConnectionBinding {
  readonly gameId: string;
  readonly player: PlayerId;
  readonly seat: number;
}

export class Connection {
  private serverSeq = 0;
  lastClientSeq = 0;
  binding: ConnectionBinding | null = null;
  /** Wall-clock timestamps of recent chat sends, for the per-connection rate limit. */
  chatTimes: number[] = [];

  constructor(
    readonly id: string,
    private readonly sink: Sink,
  ) {}

  get isBound(): boolean {
    return this.binding !== null;
  }

  send(event: ServerEvent, ackClientSeq = 0): void {
    this.serverSeq += 1;
    const env = create(ServerEnvelopeSchema, { serverSeq: this.serverSeq, ackClientSeq, event });
    this.sink(toBinary(ServerEnvelopeSchema, env));
  }
}
