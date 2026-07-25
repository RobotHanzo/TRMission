import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { clientIp } from '../src/auth/client-ip';

/** A minimal stand-in for the bits of `Request` `clientIp` reads. */
const fakeReq = (
  headers: Record<string, string | string[] | undefined>,
  ip?: string,
  remoteAddress?: string,
): Request =>
  ({
    headers,
    ip,
    socket: { remoteAddress },
  }) as unknown as Request;

describe('clientIp', () => {
  it('accepts a well-formed IPv4 CF-Connecting-IP', () => {
    expect(clientIp(fakeReq({ 'cf-connecting-ip': '203.0.113.7' }, '10.0.0.1'))).toBe(
      '203.0.113.7',
    );
  });

  it('accepts a well-formed IPv6 CF-Connecting-IP', () => {
    expect(clientIp(fakeReq({ 'cf-connecting-ip': '2001:db8::1' }, '10.0.0.1'))).toBe(
      '2001:db8::1',
    );
  });

  it('falls back to req.ip when the header is absent', () => {
    expect(clientIp(fakeReq({}, '10.0.0.1'))).toBe('10.0.0.1');
  });

  it('falls back to the raw socket address when neither the header nor req.ip is set', () => {
    expect(clientIp(fakeReq({}, undefined, '10.0.0.2'))).toBe('10.0.0.2');
  });

  it('returns undefined when no source is available at all', () => {
    expect(clientIp(fakeReq({}, undefined, undefined))).toBeUndefined();
  });

  it('rejects arbitrary non-IP text and falls back instead of persisting it', () => {
    expect(clientIp(fakeReq({ 'cf-connecting-ip': 'not-an-ip' }, '10.0.0.1'))).toBe('10.0.0.1');
  });

  it('rejects an oversized garbage string', () => {
    const junk = '1'.repeat(5000);
    expect(clientIp(fakeReq({ 'cf-connecting-ip': junk }, '10.0.0.1'))).toBe('10.0.0.1');
  });

  it('rejects a well-formed IP with a trailing injection payload', () => {
    expect(
      clientIp(fakeReq({ 'cf-connecting-ip': '8.8.8.8; DROP TABLE users' }, '10.0.0.1')),
    ).toBe('10.0.0.1');
  });

  it('rejects an IP with a trailing port (not itself a valid literal)', () => {
    expect(clientIp(fakeReq({ 'cf-connecting-ip': '8.8.8.8:1234' }, '10.0.0.1'))).toBe(
      '10.0.0.1',
    );
  });

  it('rejects an empty string header and falls back', () => {
    expect(clientIp(fakeReq({ 'cf-connecting-ip': '' }, '10.0.0.1'))).toBe('10.0.0.1');
  });

  it('ignores a duplicated header (array value) rather than trusting it', () => {
    expect(
      clientIp(fakeReq({ 'cf-connecting-ip': ['203.0.113.7', '8.8.8.8'] }, '10.0.0.1')),
    ).toBe('10.0.0.1');
  });
});
