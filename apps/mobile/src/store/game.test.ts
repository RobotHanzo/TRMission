import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, type GameEvent } from '@trm/proto';
import { useGame } from './game';

const snap = (v: number) => create(GameSnapshotSchema, { stateVersion: v, players: [] });
const ev = (playerId: string): GameEvent =>
  ({ event: { case: 'turnEnded', value: { playerId } } }) as unknown as GameEvent;

describe('game store', () => {
  beforeEach(() => useGame.getState().reset());

  it('keeps the latest snapshot and ignores stale (out-of-order) ones', () => {
    useGame.getState().applySnapshot(snap(3));
    expect(useGame.getState().snapshot?.stateVersion).toBe(3);

    useGame.getState().applySnapshot(snap(2)); // stale → ignored
    expect(useGame.getState().snapshot?.stateVersion).toBe(3);

    useGame.getState().applySnapshot(snap(4)); // newer → applied
    expect(useGame.getState().snapshot?.stateVersion).toBe(4);
  });
});

describe('game store animation bus', () => {
  beforeEach(() => useGame.getState().reset());

  it('bumps lastBatch.seq on each applyEvents and carries the batch', () => {
    expect(useGame.getState().lastBatch).toBeNull();
    useGame.getState().applyEvents(1, [ev('a')]);
    const a = useGame.getState().lastBatch!;
    expect(a.seq).toBe(1);
    expect(a.events).toHaveLength(1);
    useGame.getState().applyEvents(2, []);
    expect(useGame.getState().lastBatch!.seq).toBe(2);
  });

  it('reset clears lastBatch', () => {
    useGame.getState().applyEvents(1, [ev('a')]);
    useGame.getState().reset();
    expect(useGame.getState().lastBatch).toBeNull();
  });
});

describe('game store session replaced', () => {
  beforeEach(() => useGame.getState().reset());

  it('setSessionReplaced flips the flag', () => {
    expect(useGame.getState().sessionReplaced).toBe(false);
    useGame.getState().setSessionReplaced(true);
    expect(useGame.getState().sessionReplaced).toBe(true);
  });

  it('reset clears sessionReplaced', () => {
    useGame.getState().setSessionReplaced(true);
    useGame.getState().reset();
    expect(useGame.getState().sessionReplaced).toBe(false);
  });
});
