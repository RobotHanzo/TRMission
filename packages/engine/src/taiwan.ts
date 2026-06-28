import { TAIWAN_CONTENT, CONTENT_HASH, resolveContentByHash } from '@trm/map-data';
import { buildBoard } from './board';
import type { Board } from './board';

export { TAIWAN_CONTENT, CONTENT_HASH };

/** Build the current canonical Taiwan board (what new games are created against). */
export function taiwanBoard(): Board {
  return buildBoard(TAIWAN_CONTENT);
}

/**
 * Build the board for a game's stored `contentHash`, resolving the exact (possibly archived)
 * content version it was created against. This is what recovery uses so an in-flight game
 * always replays against its original map even after the current content has moved on.
 * Throws if the hash is not a registered version — recovery should fail loudly, never replay
 * against the wrong board.
 */
export function boardForContentHash(contentHash: string): Board {
  const content = resolveContentByHash(contentHash);
  if (!content) {
    throw new Error(`No registered map content for hash ${contentHash}`);
  }
  return buildBoard(content);
}
