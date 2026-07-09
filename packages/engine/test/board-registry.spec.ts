import { describe, it, expect } from 'vitest';
import { CONTENT_HASH, CONTENT_REGISTRY } from '@trm/map-data';
import { boardForContentHash, taiwanBoard } from '../src/taiwan';

// Resolve each registered version's hash by its map version, so this stays correct as more
// versions are archived (v2 = pre-R77-tunnel, v3 = 39-city graph, v4 = current tw2.1 network).
const entries = [...CONTENT_REGISTRY.entries()];
const hashOfVersion = (v: number): string => {
  const found = entries.find(([, c]) => c.meta.version === v);
  if (!found) throw new Error(`no registered content for version ${v}`);
  return found[0];
};

describe('boardForContentHash', () => {
  it('builds the current (v4) board for the current content hash', () => {
    const board = boardForContentHash(CONTENT_HASH);
    const current = taiwanBoard();
    // A v4 route resolves identically; the old R77 id is gone from the current map.
    expect(board.routeById.get('R5')).toEqual(current.routeById.get('R5'));
    expect(board.routeById.get('R5')).toBeDefined();
    expect(board.routeById.get('R77')).toBeUndefined();
  });

  it('builds the archived v3 board for the v3 hash — R77 is a length-2 tunnel', () => {
    const board = boardForContentHash(hashOfVersion(3));
    expect(board.routeById.get('R77')).toMatchObject({ length: 2, isTunnel: true });
  });

  it('builds the archived v2 board for the v2 hash — replaying old games against old content', () => {
    const board = boardForContentHash(hashOfVersion(2));
    expect(board.routeById.get('R77')).toMatchObject({ length: 1, isTunnel: false });
  });

  it('throws on an unregistered content hash rather than guessing a board', () => {
    expect(() => boardForContentHash('f'.repeat(64))).toThrow(/No registered map content/);
  });
});
