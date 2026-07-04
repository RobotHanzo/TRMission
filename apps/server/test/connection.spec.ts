import { describe, it, expect, vi } from 'vitest';
import { GameRegistry } from '../src/game/game-registry';
import { GameHub } from '../src/ws/hub';
import { Connection } from '../src/ws/connection';

describe('Connection.terminate', () => {
  it('invokes the closeFn with the given code and reason', () => {
    const closeFn = vi.fn();
    const conn = new Connection('c1', () => {}, closeFn);
    conn.terminate(4001, 'session_replaced');
    expect(closeFn).toHaveBeenCalledWith(4001, 'session_replaced');
  });

  it('is a no-op when no closeFn was provided', () => {
    const conn = new Connection('c1', () => {});
    expect(() => conn.terminate(4001, 'session_replaced')).not.toThrow();
  });
});

describe('GameHub.openConnection', () => {
  it('threads an optional closeFn through to the returned Connection', () => {
    const hub = new GameHub(new GameRegistry());
    const closeFn = vi.fn();
    const conn = hub.openConnection('c1', () => {}, closeFn);
    conn.terminate(4001, 'session_replaced');
    expect(closeFn).toHaveBeenCalledWith(4001, 'session_replaced');
  });

  it('keeps working with the existing 2-arg call (closeFn stays optional)', () => {
    const hub = new GameHub(new GameRegistry());
    const conn = hub.openConnection('c2', () => {});
    expect(() => conn.terminate(4001, 'session_replaced')).not.toThrow();
  });
});
