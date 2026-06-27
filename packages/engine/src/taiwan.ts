import { TAIWAN_CONTENT, CONTENT_HASH } from '@trm/map-data';
import { buildBoard } from './board';
import type { Board } from './board';

export { TAIWAN_CONTENT, CONTENT_HASH };

/** Build the default Taiwan board (the only map for now). */
export function taiwanBoard(): Board {
  return buildBoard(TAIWAN_CONTENT);
}
