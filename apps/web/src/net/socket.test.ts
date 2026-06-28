import { describe, it, expect, vi } from 'vitest';
import { create, toBinary } from '@bufbuild/protobuf';
import { ServerEnvelopeSchema } from '@trm/proto';
import { GameSocket } from './socket';

function deliver(socket: GameSocket, env: Parameters<typeof create<typeof ServerEnvelopeSchema>>[1]) {
  // Reach into the private dispatch via the message path.
  (socket as unknown as { dispatch(b: Uint8Array): void }).dispatch(
    toBinary(ServerEnvelopeSchema, create(ServerEnvelopeSchema, env)),
  );
}

describe('GameSocket history dispatch', () => {
  it('routes a HistoryReplay frame to onHistory', () => {
    const onHistory = vi.fn();
    const socket = new GameSocket('tkt', { onHistory }, 'ws://x');
    deliver(socket, {
      serverSeq: 1,
      event: {
        case: 'history',
        value: { stateVersion: 3, events: [], chat: [{ playerId: 'p1', text: 'hi', ts: 5n }] },
      },
    });
    expect(onHistory).toHaveBeenCalledTimes(1);
    expect(onHistory.mock.calls[0][1]).toEqual([{ playerId: 'p1', text: 'hi' }]);
  });
});
