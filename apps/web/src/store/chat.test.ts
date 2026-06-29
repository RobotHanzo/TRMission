import { describe, it, expect, beforeEach } from 'vitest';
import { useChat } from './chat';

describe('useChat', () => {
  beforeEach(() => useChat.getState().reset());

  it('appends live messages with ids', () => {
    useChat.getState().ingest({ playerId: 'p1', text: 'hi' });
    useChat.getState().ingest({ playerId: 'p2', text: 'yo' });
    const m = useChat.getState().messages;
    expect(m.map((x) => x.text)).toEqual(['hi', 'yo']);
    expect(m[0]?.id).not.toBe(m[1]?.id);
  });

  it('replaces messages on each history backfill (transient reconnect re-fills)', () => {
    useChat.getState().ingestHistory([{ playerId: 'p1', text: 'a' }]);
    useChat.getState().ingestHistory([
      { playerId: 'p1', text: 'b' },
      { playerId: 'p2', text: 'c' },
    ]);
    const m = useChat.getState().messages;
    expect(m).toHaveLength(2);
    expect(m[0]?.text).toBe('b');
  });
});
