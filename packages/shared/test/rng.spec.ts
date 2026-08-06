import { describe, it, expect } from 'vitest';
import { makeRng, nextU32, nextInt, shuffle, hashSeed } from '../src/rng';

describe('counter PRNG', () => {
  it('is deterministic: same seed → identical stream', () => {
    const a = makeRng('trmission');
    const b = makeRng('trmission');
    let sa = a;
    let sb = b;
    for (let i = 0; i < 100; i++) {
      const [va, na] = nextU32(sa);
      const [vb, nb] = nextU32(sb);
      expect(va).toBe(vb);
      sa = na;
      sb = nb;
    }
  });

  it('purity: input state is never mutated', () => {
    const r = makeRng(123);
    const snapshot = { ...r };
    nextU32(r);
    nextInt(r, 50);
    shuffle([1, 2, 3, 4, 5], r);
    expect(r).toEqual(snapshot);
  });

  it('advances the counter by exactly one per nextU32', () => {
    const r = makeRng(42);
    const [, n1] = nextU32(r);
    expect(n1.counter).toBe(1);
    expect(n1.seed).toBe(r.seed);
  });

  it('nextU32 stays within uint32 range', () => {
    let s = makeRng('range-check');
    // Assert once on a violation count, not 3x per iteration — see the uniformity test below.
    let outOfRange = 0;
    for (let i = 0; i < 5000; i++) {
      const [v, n] = nextU32(s);
      if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) outOfRange++;
      s = n;
    }
    expect(outOfRange).toBe(0);
  });

  it('nextInt is in range and reasonably uniform', () => {
    const buckets = new Array(6).fill(0);
    let s = makeRng('dice');
    const N = 60000;
    // Count violations and assert ONCE afterwards rather than calling expect() 2N times inside the
    // loop: vitest's assertion machinery — not the PRNG — was ~8.5s of this file's runtime, enough
    // to blow the default 5s timeout on a CI runner. Same coverage, every draw still checked.
    let outOfRange = 0;
    for (let i = 0; i < N; i++) {
      const [v, n] = nextInt(s, 6);
      if (!Number.isInteger(v) || v < 0 || v >= 6) outOfRange++;
      else buckets[v]++;
      s = n;
    }
    expect(outOfRange).toBe(0);
    // Each bucket should be within ~10% of N/6.
    for (const b of buckets) {
      expect(b).toBeGreaterThan((N / 6) * 0.9);
      expect(b).toBeLessThan((N / 6) * 1.1);
    }
  });

  it('shuffle is a permutation and is deterministic', () => {
    const input = Array.from({ length: 20 }, (_, i) => i);
    const [out1] = shuffle(input, makeRng('shuf'));
    const [out2] = shuffle(input, makeRng('shuf'));
    expect(out1).toEqual(out2);
    expect([...out1].sort((a, b) => a - b)).toEqual(input);
    expect(out1).not.toEqual(input); // astronomically unlikely to be identity
  });

  it('hashSeed is stable for a known input', () => {
    // Lock the seed hash so cross-platform drift is caught.
    expect(hashSeed('trmission')).toBe(EXPECTED.seedHash);
  });

  it('CONFORMANCE VECTOR: first uint32 outputs for seed "trmission"', () => {
    let s = makeRng('trmission');
    const got: number[] = [];
    for (let i = 0; i < 8; i++) {
      const [v, n] = nextU32(s);
      got.push(v);
      s = n;
    }
    expect(got).toEqual(EXPECTED.firstU32);
  });
});

describe('wide-key PRNG (CWE-331: ≥128-bit key)', () => {
  it('narrow makeRng is byte-identical (no `key` lane, unchanged stream)', () => {
    const r = makeRng('trmission');
    expect(r).toEqual({ seed: EXPECTED.seedHash, counter: 0 });
    expect('key' in r).toBe(false);
  });

  it('wide makeRng adds three independent uint32 key lanes', () => {
    const r = makeRng('trmission', true);
    expect(r.seed).toBe(EXPECTED.seedHash); // primary lane unchanged from narrow
    expect(r.counter).toBe(0);
    expect(r.key).toEqual(EXPECTED.wideKey);
  });

  it('wide stream differs from narrow for the same seed', () => {
    const [nv] = nextU32(makeRng('trmission'));
    const [wv] = nextU32(makeRng('trmission', true));
    expect(wv).not.toBe(nv);
  });

  it('refuses a numeric seed in wide mode instead of silently deriving weak key lanes', () => {
    // A numeric seed is already the narrow 32-bit value; deriving "wide" lanes from it would just
    // re-derive them from that same 32-bit quantity, reconstructible by anyone who brute-forces the
    // narrow keyspace. Wide callers must supply a full-entropy string seed instead.
    expect(() => makeRng(123, true)).toThrow(/wideSeed requires a string seed/);
  });

  it('purity: wide input state is never mutated (key carried forward, not shared-mutated)', () => {
    const r = makeRng('wide-purity', true);
    const snapshot = structuredClone(r);
    nextU32(r);
    nextInt(r, 50);
    shuffle([1, 2, 3, 4, 5], r);
    expect(r).toEqual(snapshot);
  });

  it('wide stream is deterministic and reasonably uniform', () => {
    const a = makeRng('wide-det', true);
    const b = makeRng('wide-det', true);
    let sa = a;
    let sb = b;
    const buckets = new Array(6).fill(0);
    for (let i = 0; i < 12000; i++) {
      const [va, na] = nextInt(sa, 6);
      const [vb, nb] = nextInt(sb, 6);
      expect(va).toBe(vb);
      buckets[va]++;
      sa = na;
      sb = nb;
    }
    for (const bkt of buckets) expect(bkt).toBeGreaterThan((12000 / 6) * 0.85);
  });

  it('CONFORMANCE VECTOR (WIDE): first uint32 outputs for seed "trmission"', () => {
    // Locks the widened stream so cross-platform drift (or an accidental key-derivation change) is
    // caught. Independent of the narrow vector above, which must stay frozen for pre-v13 replay.
    let s = makeRng('trmission', true);
    const got: number[] = [];
    for (let i = 0; i < 8; i++) {
      const [v, n] = nextU32(s);
      got.push(v);
      s = n;
    }
    expect(got).toEqual(EXPECTED.wideFirstU32);
  });
});

// Golden cross-platform conformance vector. If this ever changes, replay determinism is broken.
const EXPECTED = {
  seedHash: 2521953783,
  firstU32: [
    1604230451, 3122439212, 3589591140, 616620042, 2729028958, 718574250, 1660188389, 2413182989,
  ],
  // Widened key lanes + stream for the same seed (CWE-331). Frozen the same way as the narrow
  // vector; a drift here means new (v13+) games would not replay byte-identically.
  wideKey: [3898368266, 3894229352, 948809102],
  wideFirstU32: [
    748670661, 3349310717, 2570668845, 4034785192, 1693199772, 1862944428, 1056466276, 3683678573,
  ],
};
