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

  it('ingestConnectionChange appends a live player-left / player-reconnected entry', () => {
    useLog.getState().ingestConnectionChange('p1', false);
    useLog.getState().ingestConnectionChange('p1', true);
    const e = useLog.getState().entries;
    expect(e).toHaveLength(2);
    expect(e[0]).toMatchObject({ kind: 'playerLeft', playerId: 'p1' });
    expect(e[1]).toMatchObject({ kind: 'playerReconnected', playerId: 'p1' });
  });

  it('backfill interleaves the connection log at its recorded splice point', () => {
    useLog.getState().ingestHistory(
      [turn('p1'), turn('p2')],
      [
        { playerId: 'p3', connected: false, afterEventIndex: 1 },
        { playerId: 'p4', connected: false, afterEventIndex: 0 },
      ],
    );
    const e = useLog.getState().entries;
    // p4's notice (afterEventIndex 0) comes before any event; p1's turn; p3's notice
    // (afterEventIndex 1) after the first event; then p2's turn.
    expect(e.map((x) => [x.kind, x.playerId])).toEqual([
      ['playerLeft', 'p4'],
      ['turnStarted', 'p1'],
      ['playerLeft', 'p3'],
      ['turnStarted', 'p2'],
    ]);
  });
});

describe('contextual log store', () => {
  beforeEach(() => useLog.getState().reset());

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
