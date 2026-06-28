import { describe, it, expect, beforeEach } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { GameEventSchema } from '@trm/proto';
import { useLog } from './log';

const turn = (playerId: string) =>
  create(GameEventSchema, { event: { case: 'turnStarted', value: { playerId, orderIndex: 0 } } });

describe('useLog', () => {
  beforeEach(() => useLog.getState().reset());

  it('appends live events with unique ids', () => {
    useLog.getState().ingestLive([turn('p1')]);
    useLog.getState().ingestLive([turn('p2')]);
    const e = useLog.getState().entries;
    expect(e).toHaveLength(2);
    expect(e[0]?.id).not.toBe(e[1]?.id);
    expect(e[1]?.playerId).toBe('p2');
  });

  it('replaces entries on each history backfill (transient reconnect re-fills)', () => {
    useLog.getState().ingestHistory([turn('p1'), turn('p2')]);
    expect(useLog.getState().entries).toHaveLength(2);
    useLog.getState().ingestHistory([turn('p3')]); // a reconnect re-sends the full history
    const e = useLog.getState().entries;
    expect(e).toHaveLength(1);
    expect(e[0]?.playerId).toBe('p3');
  });

  it('reset clears entries', () => {
    useLog.getState().ingestLive([turn('p1')]);
    useLog.getState().reset();
    expect(useLog.getState().entries).toEqual([]);
  });
});
