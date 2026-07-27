import { describe, expect, it } from 'vitest';
import {
  TELEMETRY_REDACTED,
  isSensitiveTelemetryKey,
  scrubTelemetryBreadcrumb,
  scrubTelemetryEvent,
  scrubTelemetryText,
  scrubTelemetryUrl,
  scrubTelemetryValue,
  telemetrySampleRate,
} from './telemetry';

describe('isSensitiveTelemetryKey', () => {
  it('denies every hidden-information field the wire redaction exists to withhold', () => {
    for (const key of [
      'hand',
      'hands',
      'playerHand',
      'player_hand',
      'keptTickets',
      'pendingTicketOffer',
      'deck',
      'ticketDeckLong',
      'ticketDeckShort',
      'discard',
      'discardPile',
      'rng',
      'seed',
      'selfView',
      'you',
      'gameState',
    ]) {
      expect(isSensitiveTelemetryKey(key), key).toBe(true);
    }
  });

  it('denies credentials', () => {
    for (const key of [
      'token',
      'accessToken',
      'refreshToken',
      'pushToken',
      'deviceToken',
      'jwt',
      'ticket',
      'credential',
      'authorization',
      'cookie',
      'password',
      'passwordHash',
      'secret',
      'clientSecret',
      'privateKey',
    ]) {
      expect(isSensitiveTelemetryKey(key), key).toBe(true);
    }
  });

  it('denies the advertising identifiers the store policies govern', () => {
    for (const key of ['idfa', 'idfv', 'advertisingId', 'adId', 'gaid', 'appSetId']) {
      expect(isSensitiveTelemetryKey(key), key).toBe(true);
    }
  });

  it('leaves the fields that make a report actionable alone', () => {
    for (const key of [
      'gameId',
      'roomCode',
      'userId',
      'playerId',
      'seat',
      'handler',
      'deckId',
      'contentHash',
      'stateDigest',
      'actionSeq',
      'phase',
      'market',
      'ownership',
      'engineVersion',
    ]) {
      expect(isSensitiveTelemetryKey(key), key).toBe(false);
    }
  });

  // The 2026-07 narrowing: a report nobody can attribute to an account is a report nobody can act
  // on. These are our own users' data, disclosed by our own privacy policy — not secrets.
  it('leaves ordinary identifiers alone', () => {
    for (const key of [
      'email',
      'emails',
      'ip',
      'ipAddress',
      'remoteAddr',
      'phone',
      'displayName',
    ]) {
      expect(isSensitiveTelemetryKey(key), key).toBe(false);
    }
  });
});

describe('scrubTelemetryValue', () => {
  it('drops sensitive values at any depth without touching the rest', () => {
    const scrubbed = scrubTelemetryValue({
      gameId: 'g1',
      players: [{ id: 'p1', seat: 0, hand: { RED: 3 }, keptTickets: ['t1'], trainCars: 42 }],
      deck: ['RED', 'BLUE'],
      rng: { seed: 7, counter: 3 },
    });
    expect(scrubbed).toEqual({
      gameId: 'g1',
      players: [
        {
          id: 'p1',
          seat: 0,
          hand: TELEMETRY_REDACTED,
          keptTickets: TELEMETRY_REDACTED,
          trainCars: 42,
        },
      ],
      deck: TELEMETRY_REDACTED,
      rng: TELEMETRY_REDACTED,
    });
  });

  it('never mutates the caller-supplied object', () => {
    const original = { hand: { RED: 3 } };
    scrubTelemetryValue(original);
    expect(original.hand).toEqual({ RED: 3 });
  });

  it('terminates on cycles', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(scrubTelemetryValue(a)).toEqual({ name: 'a', self: '[circular]' });
  });

  it('caps depth, array length, and key count', () => {
    let deep: Record<string, unknown> = { leaf: 'bottom' };
    for (let i = 0; i < 12; i += 1) deep = { nested: deep };
    expect(JSON.stringify(scrubTelemetryValue(deep))).toContain('trm:depth-capped');

    const long = scrubTelemetryValue(Array.from({ length: 200 }, (_, i) => i)) as unknown[];
    expect(long).toHaveLength(51);
    expect(long.at(-1)).toBe('…150 more');

    const wide = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`k${i}`, i]));
    expect((scrubTelemetryValue(wide) as Record<string, unknown>)['…']).toBe('[trm:keys-capped]');
  });

  it('stringifies non-plain objects instead of walking their getters', () => {
    expect(scrubTelemetryValue({ err: new TypeError('boom') })).toEqual({
      err: 'TypeError: boom',
    });
  });
});

describe('scrubTelemetryText', () => {
  it('redacts JWTs and bearer credentials in free text', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJlLWhlcmU';
    expect(scrubTelemetryText(`ticket ${jwt} rejected`)).toBe(
      `ticket ${TELEMETRY_REDACTED} rejected`,
    );
    expect(scrubTelemetryText('Authorization: Bearer abcdef0123456789')).toBe(
      `Authorization: ${TELEMETRY_REDACTED}`,
    );
  });

  it('keeps an email address — it is the actionable half of the message', () => {
    expect(scrubTelemetryText('no account for player@example.com')).toBe(
      'no account for player@example.com',
    );
  });

  it('truncates runaway strings', () => {
    expect(scrubTelemetryText('x'.repeat(9000))).toMatch(/…\[truncated\]$/);
  });
});

describe('scrubTelemetryUrl', () => {
  it('strips sensitive query parameters and keeps the path', () => {
    expect(scrubTelemetryUrl('https://trm.example/ws?ticket=abc&gameId=g1')).toBe(
      `https://trm.example/ws?ticket=${TELEMETRY_REDACTED}&gameId=g1`,
    );
    expect(scrubTelemetryUrl('/api/v1/auth/oauth/google/callback?code=xyz&state=s1')).toBe(
      `/api/v1/auth/oauth/google/callback?code=${TELEMETRY_REDACTED}&state=${TELEMETRY_REDACTED}`,
    );
  });

  it('passes a query-less URL through', () => {
    expect(scrubTelemetryUrl('/room/ABCDE')).toBe('/room/ABCDE');
  });
});

describe('scrubTelemetryEvent', () => {
  it('scrubs message, exception values, request, breadcrumbs, extra, tags and user', () => {
    const event = scrubTelemetryEvent({
      message: 'login failed for a@b.com with bad ticket eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.c2ln',
      exception: { values: [{ value: 'bad ticket eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.c2ln' }] },
      request: {
        url: 'https://trm.example/login?token=abc',
        query_string: 'token=abc&next=/room/AAAAA',
        headers: { cookie: 'trm_refresh=zzz', 'user-agent': 'jsdom' },
        data: { password: 'hunter2', locale: 'zh-Hant' },
      },
      breadcrumbs: [{ message: 'ws hello', data: { ticket: 'abc', gameId: 'g1' } }],
      extra: { hand: { RED: 2 }, seat: 1 },
      tags: { gameId: 'g1' },
      user: { id: 'u1', email: 'a@b.com', ip_address: '203.0.113.7' },
    });

    expect(event.message).toBe(`login failed for a@b.com with bad ticket ${TELEMETRY_REDACTED}`);
    expect(event.exception?.values?.[0]?.value).toBe(`bad ticket ${TELEMETRY_REDACTED}`);
    expect(event.request?.url).toBe(`https://trm.example/login?token=${TELEMETRY_REDACTED}`);
    expect(event.request?.query_string).toBe(`token=${TELEMETRY_REDACTED}&next=/room/AAAAA`);
    expect(event.request?.headers).toEqual({
      cookie: TELEMETRY_REDACTED,
      'user-agent': 'jsdom',
    });
    expect(event.request?.data).toEqual({ password: TELEMETRY_REDACTED, locale: 'zh-Hant' });
    expect(event.breadcrumbs?.[0]?.data).toEqual({ ticket: TELEMETRY_REDACTED, gameId: 'g1' });
    expect(event.extra).toEqual({ hand: TELEMETRY_REDACTED, seat: 1 });
    expect(event.tags).toEqual({ gameId: 'g1' });
    // The user context survives intact — that is the whole point of attaching it.
    expect(event.user).toEqual({ id: 'u1', email: 'a@b.com', ip_address: '203.0.113.7' });
  });

  it('is a no-op on an empty event', () => {
    expect(scrubTelemetryEvent({})).toEqual({});
  });
});

describe('scrubTelemetryBreadcrumb', () => {
  it('applies the same denylist to a single crumb', () => {
    expect(
      scrubTelemetryBreadcrumb({ message: 'hi a@b.com', data: { hand: {}, email: 'a@b.com' } }),
    ).toEqual({
      message: 'hi a@b.com',
      data: { hand: TELEMETRY_REDACTED, email: 'a@b.com' },
    });
  });
});

describe('telemetrySampleRate', () => {
  it('falls back on unset/blank/garbage and clamps to [0, 1]', () => {
    expect(telemetrySampleRate(undefined, 0.2)).toBe(0.2);
    expect(telemetrySampleRate('   ', 0.2)).toBe(0.2);
    expect(telemetrySampleRate('nope', 0.2)).toBe(0.2);
    expect(telemetrySampleRate('0', 0.2)).toBe(0);
    expect(telemetrySampleRate('0.5', 0.2)).toBe(0.5);
    expect(telemetrySampleRate('7', 0.2)).toBe(1);
    expect(telemetrySampleRate('-1', 0.2)).toBe(0);
  });
});
