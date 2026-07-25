jest.mock('expo-crypto', () => ({
  getRandomValues: jest.fn(),
  digestStringAsync: jest.fn(),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { HEX: 'hex' },
}));

import * as Crypto from 'expo-crypto';
import { generatePkcePair } from './pkce';

const mGetRandomValues = Crypto.getRandomValues as jest.Mock;
const mDigestStringAsync = Crypto.digestStringAsync as jest.Mock;

describe('generatePkcePair', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mDigestStringAsync.mockResolvedValue('c'.repeat(64));
  });

  it('derives a 64-char lowercase-hex verifier from 32 fresh random bytes', async () => {
    mGetRandomValues.mockImplementation((arr: Uint8Array) => {
      arr.fill(0xab);
      return arr;
    });
    const { verifier } = await generatePkcePair();
    expect(verifier).toBe('ab'.repeat(32));
    expect(verifier).toMatch(/^[0-9a-f]{64}$/);
    expect(mGetRandomValues).toHaveBeenCalledTimes(1);
    expect((mGetRandomValues.mock.calls[0]?.[0] as Uint8Array).length).toBe(32);
  });

  it('computes the challenge as the SHA-256 hex digest of the verifier string, not the raw bytes', async () => {
    mGetRandomValues.mockImplementation((arr: Uint8Array) => arr.fill(1));
    const { verifier, challenge } = await generatePkcePair();
    expect(mDigestStringAsync).toHaveBeenCalledWith(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
      encoding: Crypto.CryptoEncoding.HEX,
    });
    expect(challenge).toBe('c'.repeat(64));
  });

  it('generates a fresh, different verifier on every call (never reused across flows)', async () => {
    let call = 0;
    mGetRandomValues.mockImplementation((arr: Uint8Array) => {
      call += 1;
      arr.fill(call);
      return arr;
    });
    const first = await generatePkcePair();
    const second = await generatePkcePair();
    expect(first.verifier).not.toBe(second.verifier);
  });
});
