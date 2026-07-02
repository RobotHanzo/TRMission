import { describe, it, expect } from 'vitest';
import {
  TAIWAN_CONTENT,
  CONTENT_HASH,
  CONTENT_REGISTRY,
  resolveContentByHash,
  hashContent,
  validateContent,
} from '../src/index';
import { CONTENT_V2 } from '../src/archive/v2';

describe('content version registry', () => {
  it('keys every registered version by its own content hash', () => {
    for (const [hash, content] of CONTENT_REGISTRY) {
      expect(hashContent(content)).toBe(hash);
    }
  });

  it('registers the current content under CONTENT_HASH', () => {
    expect(CONTENT_REGISTRY.get(CONTENT_HASH)).toBe(TAIWAN_CONTENT);
    expect(resolveContentByHash(CONTENT_HASH)).toBe(TAIWAN_CONTENT);
  });

  it('resolves an archived version by its hash', () => {
    const v2Hash = hashContent(CONTENT_V2);
    expect(v2Hash).not.toBe(CONTENT_HASH);
    expect(resolveContentByHash(v2Hash)).toBe(CONTENT_V2);
  });

  it('returns undefined for an unknown hash', () => {
    expect(resolveContentByHash('0'.repeat(64))).toBeUndefined();
  });

  it('current content is map version 3 with R77 as a length-2 tunnel', () => {
    expect(TAIWAN_CONTENT.meta.version).toBe(3);
    const r77 = TAIWAN_CONTENT.routes.find((r) => r.id === 'R77');
    expect(r77).toMatchObject({ length: 2, isTunnel: true });
  });

  it('v2 content is map version 2 with R77 as a plain length-1 segment', () => {
    expect(CONTENT_V2.meta.version).toBe(2);
    const r77 = CONTENT_V2.routes.find((r) => r.id === 'R77');
    expect(r77).toMatchObject({ length: 1, isTunnel: false });
  });

  it('v2 differs from current only at R77', () => {
    const diff = TAIWAN_CONTENT.routes.filter((cur) => {
      const old = CONTENT_V2.routes.find((r) => r.id === cur.id);
      return JSON.stringify(old) !== JSON.stringify(cur);
    });
    expect(diff.map((r) => r.id)).toEqual(['R77']);
  });

  it('every archived version is itself a structurally valid map', () => {
    for (const content of CONTENT_REGISTRY.values()) {
      expect(validateContent(content).ok).toBe(true);
    }
  });

  // Tripwire: the v2 snapshot must be byte-stable forever so already-persisted v2 games keep
  // resolving. If this fails after a content edit, a v2-era city/route/ticket drifted and the
  // archive snapshot must be frozen as a full literal (see archive/v2.ts).
  it('pins the v2 content hash', () => {
    expect(hashContent(CONTENT_V2)).toBe(
      '617c33e2f5da2a1c3345defd2fb8f9db988c0bd63662726687b3bb70e5a35c6c',
    );
  });

  // Same tripwire for the current version: pinned when the hashContent formula was extended
  // with optional geography/rules (custom maps) to prove the extension moved no existing hash.
  it('pins the v3 content hash', () => {
    expect(hashContent(TAIWAN_CONTENT)).toBe(
      '26ad5c18b2cd52c4ccea89de4319843b0dc46a1cdf992333fbfa0d8abe173b09',
    );
  });
});
