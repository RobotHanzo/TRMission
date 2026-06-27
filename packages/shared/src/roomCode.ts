import type { RngState } from './rng';
import { nextInt } from './rng';

/** Unambiguous alphabet for room codes (no 0/O/1/I/L). */
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Generate a room code from a seeded RNG (deterministic; server seeds with entropy). */
export function generateRoomCode(rng: RngState, length = 6): [string, RngState] {
  let out = '';
  let state = rng;
  for (let i = 0; i < length; i++) {
    const [idx, next] = nextInt(state, ROOM_CODE_ALPHABET.length);
    state = next;
    out += ROOM_CODE_ALPHABET[idx];
  }
  return [out, state];
}
