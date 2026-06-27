import { describe, it, expect } from 'vitest';
import { sha256Hex, stableStringify, digest } from '../src/digest';

describe('sha256Hex', () => {
  it('matches known NIST test vectors', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(
      sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('handles multi-byte UTF-8 (CJK) deterministically', () => {
    // 台鐵任務 — same bytes everywhere → same hash.
    expect(sha256Hex('台鐵任務')).toBe(sha256Hex('台鐵任務'));
    expect(sha256Hex('台鐵任務')).toHaveLength(64);
  });
});

describe('stableStringify', () => {
  it('is independent of object key insertion order', () => {
    const a = { x: 1, y: { b: 2, a: 3 }, z: [3, { q: 1, p: 2 }] };
    const b = { z: [3, { p: 2, q: 1 }], y: { a: 3, b: 2 }, x: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(digest(a)).toBe(digest(b));
  });

  it('preserves array order (arrays are ordered)', () => {
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]));
  });
});
