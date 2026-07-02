import { describe, it, expect, beforeEach } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { GameEventSchema } from '@trm/proto';
import type { LogEntry } from '../game/logModel';
import { useLog, createLogStore } from './log';

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

describe('contextual log store', () => {
  it('createLogStore returns an isolated instance (singleton untouched)', () => {
    const iso = createLogStore();
    iso.setState({
      entries: [
        {
          id: 1,
          kind: 'gameStarted',
          playerId: null,
          data: {},
          importance: 'normal',
        } as unknown as LogEntry,
      ],
      nextId: 2,
    });
    expect(iso.getState().entries).toHaveLength(1);
    expect(useLog.getState().entries).toHaveLength(0);
  });
});
