import { describe, it, expect } from 'vitest';
import { CONTENT_HASH, CONTENT_REGISTRY } from '@trm/map-data';
import { boardForContentHash, taiwanBoard } from '../src/taiwan';

// The archived (non-current) hash registered alongside the current one.
const v2Hash = [...CONTENT_REGISTRY.keys()].find((h) => h !== CONTENT_HASH)!;

describe('boardForContentHash', () => {
  it('builds the current board for the current content hash', () => {
    const board = boardForContentHash(CONTENT_HASH);
    const current = taiwanBoard();
    expect(board.routeById.get('R77')).toEqual(current.routeById.get('R77'));
    expect(board.routeById.get('R77')).toMatchObject({ length: 2, isTunnel: true });
  });

  it('builds the archived v2 board for the v2 hash — replaying old games against old content', () => {
    expect(v2Hash).toBeDefined();
    const board = boardForContentHash(v2Hash);
    expect(board.routeById.get('R77')).toMatchObject({ length: 1, isTunnel: false });
  });

  it('throws on an unregistered content hash rather than guessing a board', () => {
    expect(() => boardForContentHash('f'.repeat(64))).toThrow(/No registered map content/);
  });
});
