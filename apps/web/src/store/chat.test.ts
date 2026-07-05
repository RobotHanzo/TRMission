import { describe, it, expect, beforeEach } from 'vitest';
import { useChat } from './chat';

describe('useChat', () => {
  beforeEach(() => useChat.getState().reset());

  it('appends live messages with ids', () => {
    useChat.getState().ingest({ playerId: 'p1', content: { case: 'text', value: 'hi' } });
    useChat.getState().ingest({ playerId: 'p2', content: { case: 'text', value: 'yo' } });
    const m = useChat.getState().messages;
    expect(m.map((x) => x.content)).toEqual([
      { case: 'text', value: 'hi' },
      { case: 'text', value: 'yo' },
    ]);
    expect(m[0]?.id).not.toBe(m[1]?.id);
  });

  it('replaces messages on each history backfill (transient reconnect re-fills)', () => {
    useChat.getState().ingestHistory([{ playerId: 'p1', content: { case: 'text', value: 'a' } }]);
    useChat.getState().ingestHistory([
      { playerId: 'p1', content: { case: 'text', value: 'b' } },
      { playerId: 'p2', content: { case: 'text', value: 'c' } },
    ]);
    const m = useChat.getState().messages;
    expect(m).toHaveLength(2);
    expect(m[0]?.content).toEqual({ case: 'text', value: 'b' });
  });

  it('tracks the last live message but ignores history backfill', () => {
    expect(useChat.getState().lastLive).toBeNull();
    useChat.getState().ingestHistory([{ playerId: 'p1', content: { case: 'text', value: 'a' } }]);
    expect(useChat.getState().lastLive).toBeNull();
    useChat.getState().ingest({ playerId: 'p2', content: { case: 'text', value: 'hi' } });
    expect(useChat.getState().lastLive).toEqual({
      id: 2,
      playerId: 'p2',
      content: { case: 'text', value: 'hi' },
    });
  });

  it('ingests a preset message distinctly from free text', () => {
    useChat.getState().ingest({ playerId: 'p1', content: { case: 'presetId', value: 'GOOD_LUCK' } });
    expect(useChat.getState().messages[0]?.content).toEqual({
      case: 'presetId',
      value: 'GOOD_LUCK',
    });
  });
});
