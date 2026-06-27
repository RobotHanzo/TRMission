import { describe, it, expect, beforeEach } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema } from '@trm/proto';
import { useGame } from './game';

const snap = (v: number) => create(GameSnapshotSchema, { stateVersion: v, players: [] });

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
