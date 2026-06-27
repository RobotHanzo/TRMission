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
    for (let i = 0; i < 5000; i++) {
      const [v, n] = nextU32(s);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(v)).toBe(true);
      s = n;
    }
  });

  it('nextInt is in range and reasonably uniform', () => {
    const buckets = new Array(6).fill(0);
    let s = makeRng('dice');
    const N = 60000;
    for (let i = 0; i < N; i++) {
      const [v, n] = nextInt(s, 6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      buckets[v]++;
      s = n;
    }
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

// Golden cross-platform conformance vector. If this ever changes, replay determinism is broken.
const EXPECTED = {
  seedHash: 2521953783,
  firstU32: [
    1604230451, 3122439212, 3589591140, 616620042, 2729028958, 718574250, 1660188389, 2413182989,
  ],
};
