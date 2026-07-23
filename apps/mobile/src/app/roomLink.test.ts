import { consumePendingRoomLink, parseRoomLink, stashRoomLink } from './roomLink';

// Under jest expo-constants carries no extra, so SERVER_ORIGIN is config.ts's default.
const ORIGIN = 'https://trmission.robothanzo.dev';

describe('parseRoomLink', () => {
  it('parses the custom scheme, with and without an empty authority', () => {
    expect(parseRoomLink('trmission://room/AB12CD')).toBe('AB12CD');
    expect(parseRoomLink('trmission:///room/AB12CD')).toBe('AB12CD');
  });

  it('parses web share URLs on the server origin, ignoring query/hash', () => {
    expect(parseRoomLink(`${ORIGIN}/room/AB12CD`)).toBe('AB12CD');
    expect(parseRoomLink(`${ORIGIN}/room/AB12CD?ref=chat#x`)).toBe('AB12CD');
  });

  it('rejects non-room and foreign-host URLs', () => {
    expect(parseRoomLink('trmission:///m/callback?code=xyz')).toBeNull();
    expect(parseRoomLink(`${ORIGIN}/`)).toBeNull();
    expect(parseRoomLink(`${ORIGIN}/replay/abc`)).toBeNull();
    expect(parseRoomLink('https://evil.example/room/AB12CD')).toBeNull();
  });
});

describe('stash / consume', () => {
  it('hands the code over exactly once', () => {
    stashRoomLink('trmission://room/ZZ99YY');
    expect(consumePendingRoomLink()).toBe('ZZ99YY');
    expect(consumePendingRoomLink()).toBeNull();
  });

  it('ignores non-room URLs without clobbering a pending code', () => {
    stashRoomLink(`${ORIGIN}/room/AB12CD`);
    stashRoomLink('trmission:///m/callback?code=xyz');
    expect(consumePendingRoomLink()).toBe('AB12CD');
  });
});
