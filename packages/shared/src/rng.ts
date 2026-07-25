/**
 * Counter-based pseudo-random number generator — the determinism backbone (ADR A4).
 *
 * The random source is serializable uint32 scalars: `{ seed, counter }` for the historical
 * NARROW key, plus an optional `key` lane array that WIDENS the key for new games (see below).
 * Every value is a pure function of the whole state, so a game replays byte-identically from its
 * seed + action log. All arithmetic is integer-only (`Math.imul` / `>>> 0`) so the stream is
 * identical across V8 in Node and the browser. A checked-in conformance vector (see rng.spec.ts)
 * guards against drift.
 *
 * KEY WIDTH (CWE-331 fix). A game seed is a 122-bit `randomUUID()`, but the narrow key collapses
 * it into a single 32-bit `seed`, so an observer of the public genesis state could brute-force the
 * whole 2^32 keyspace offline and recover every hidden shuffle (deck order, dealt hands, ticket
 * decks). The WIDE key (`makeRng(seed, true)`, used by every new game from engine v13 on) carries
 * three additional independent hash lanes of the full seed string in `key`, so the stream is keyed
 * on 128 bits (`seed` + 3 lanes) and can no longer be searched from a 32-bit space. The lanes are a
 * deterministic function of the seed — no new entropy is drawn — so replay is preserved. The narrow
 * path (no `key`) is left byte-identical, so pre-v13 games and the golden replay digests are
 * unchanged.
 *
 * This module is NOT in the engine package, so it may live in @trm/shared and be reused
 * by the server (seed generation) and tests. The engine only ever advances it via these
 * pure functions.
 */

export interface RngState {
  /** uint32 */
  readonly seed: number;
  /** uint32, monotonically increasing */
  readonly counter: number;
  /**
   * Optional extra key lanes (each uint32) that widen the RNG key beyond the single 32-bit `seed`.
   * Absent (key omitted, not `undefined`) for the historical narrow RNG, so a narrow game's state
   * digests byte-identically to a pre-widening game and every pre-v13 replay is unchanged. When
   * present it holds independent hash lanes of the full seed string, keying the stream on ≥128 bits.
   */
  readonly key?: readonly number[];
}

/** splitmix32 finalizer — a strong integer hash of a uint32. */
function mix32(x: number): number {
  x = x >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x21f0aaad);
  x ^= x >>> 15;
  x = Math.imul(x, 0x735a2d97);
  x ^= x >>> 15;
  return x >>> 0;
}

/** Hash an arbitrary string to a uint32 seed (cyrb-style). */
export function hashSeed(input: string): number {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

/**
 * Create an RNG from a string or numeric seed (counter starts at 0).
 *
 * `wide` selects the ≥128-bit key (CWE-331): three extra independent hash lanes of the full seed,
 * each domain-separated so it depends on every bit of the seed. Deterministic (no new entropy), so
 * replay is preserved. The default (`wide` false/omitted) is the historical narrow key and is left
 * byte-identical, so content generation, room codes, and every pre-v13 game are unaffected — only
 * callers that opt in (new games, via `GameConfig.wideSeed`) get the widened stream.
 *
 * A numeric `seed` is REJECTED when `wide` is true: a JS number here is already the narrow 32-bit
 * value (`seed >>> 0`), so deriving the extra key lanes from it would just re-derive them from that
 * same 32-bit quantity — reconstructible by anyone who brute-forces the narrow keyspace, silently
 * defeating the widening this flag exists to provide. Wide callers must pass the full-entropy seed
 * as a string (as every current production caller already does).
 */
export function makeRng(seed: string | number, wide = false): RngState {
  const s = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  if (!wide) return { seed: s, counter: 0 };
  if (typeof seed === 'number') {
    throw new Error(
      'wideSeed requires a string seed with sufficient entropy; numeric seeds cannot be widened',
    );
  }
  return {
    seed: s,
    counter: 0,
    key: [
      hashSeed(`trm-rng/1|${seed}`),
      hashSeed(`trm-rng/2|${seed}`),
      hashSeed(`trm-rng/3|${seed}`),
    ],
  };
}

/** Next uint32 value + advanced state (pure). */
export function nextU32(r: RngState): [number, RngState] {
  // Narrow branch is byte-identical to the pre-widening implementation (no `key` ⇒ unchanged
  // stream and unchanged serialized shape). The wide branch folds each extra key lane into the
  // mixed value, consuming exactly one counter step just like the narrow path.
  const c = mix32((r.counter + 0x9e3779b9) >>> 0);
  let v = mix32((r.seed ^ c) >>> 0);
  if (r.key !== undefined) {
    for (let i = 0; i < r.key.length; i++) v = mix32((v ^ (r.key[i] as number)) >>> 0);
    return [v, { seed: r.seed, counter: (r.counter + 1) >>> 0, key: r.key }];
  }
  return [v, { seed: r.seed, counter: (r.counter + 1) >>> 0 }];
}

/** Unbiased integer in [0, n) via rejection sampling (pure). */
export function nextInt(r: RngState, n: number): [number, RngState] {
  if (!Number.isInteger(n) || n <= 0)
    throw new RangeError(`nextInt bound must be a positive integer, got ${n}`);
  const range = n >>> 0;
  // Largest multiple of `range` that fits in uint32, to discard the biased tail.
  const max = Math.floor(0x100000000 / range) * range;
  let state = r;
  for (;;) {
    const [v, next] = nextU32(state);
    state = next;
    if (v < max) return [v % range, state];
  }
}

/** Fisher–Yates shuffle returning a NEW array + advanced state (pure; input untouched). */
export function shuffle<T>(arr: readonly T[], r: RngState): [T[], RngState] {
  const out = arr.slice();
  let state = r;
  for (let i = out.length - 1; i > 0; i--) {
    const [j, next] = nextInt(state, i + 1);
    state = next;
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return [out, state];
}
