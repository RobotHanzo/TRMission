/**
 * Counter-based pseudo-random number generator — the determinism backbone (ADR A4).
 *
 * The entire random source is two serializable uint32 scalars `{ seed, counter }`.
 * Every value is a pure function of `(seed, counter)`, so a game replays byte-identically
 * from its seed + action log. All arithmetic is integer-only (`Math.imul` / `>>> 0`) so
 * the stream is identical across V8 in Node and the browser. A checked-in conformance
 * vector (see test/conformance.spec.ts) guards against drift.
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

/** Create an RNG from a string or numeric seed (counter starts at 0). */
export function makeRng(seed: string | number): RngState {
  const s = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  return { seed: s, counter: 0 };
}

/** Next uint32 value + advanced state (pure). */
export function nextU32(r: RngState): [number, RngState] {
  const v = mix32((r.seed ^ mix32((r.counter + 0x9e3779b9) >>> 0)) >>> 0);
  return [v, { seed: r.seed, counter: (r.counter + 1) >>> 0 }];
}

/** Unbiased integer in [0, n) via rejection sampling (pure). */
export function nextInt(r: RngState, n: number): [number, RngState] {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError(`nextInt bound must be a positive integer, got ${n}`);
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
