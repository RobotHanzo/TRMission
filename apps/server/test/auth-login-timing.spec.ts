import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../src/auth/auth.service';
import type { UserDoc, UserRepo } from '../src/auth/user.repo';
import type { SessionRepo } from '../src/auth/session.repo';
import type { TokenService } from '../src/auth/token.service';
import type { FeatureDefaultsRepo } from '../src/auth/feature-defaults.repo';

// Fake argon2: `hash` tags its input into the output so a test can see exactly which input
// was hashed; `verify` mirrors just enough real semantics (a hash produced by `hash(x)`
// verifies only against `x`) for these call-pattern assertions. This suite is about *whether*
// and *what* login hashes/verifies (the CWE-208 timing-oracle mitigation), not argon2's own
// correctness — real argon2 round-trips are already covered by test/auth.e2e.spec.ts.
vi.mock('@node-rs/argon2', () => ({
  hash: vi.fn(async (input: string) => `argon2:${input}`),
  verify: vi.fn(async (h: string, password: string) => h === `argon2:${password}`),
}));

import { hash, verify } from '@node-rs/argon2';

/** DI-free construction (mirrors test/purge-scheduler.spec.ts's style for PurgeService):
 *  `login` only ever touches `UserRepo.findByEmail` plus (on success) `issue()`'s
 *  collaborators, so the rest can stay minimal stand-ins. */
function makeService(users: Map<string, UserDoc>): AuthService {
  const userRepo = {
    findByEmail: async (email: string) => users.get(email) ?? null,
    recordLogin: async () => undefined,
  } as unknown as UserRepo;
  const sessionRepo = { create: async () => 'fake-refresh-token' } as unknown as SessionRepo;
  const tokenService = { signAccess: () => 'fake-access-token' } as unknown as TokenService;
  const featureDefaults = { get: async () => [] } as unknown as FeatureDefaultsRepo;
  return new AuthService(userRepo, sessionRepo, tokenService, featureDefaults);
}

function makeUser(overrides: Partial<UserDoc> = {}): UserDoc {
  return {
    _id: 'u1',
    displayName: 'Alice',
    isGuest: false,
    email: 'alice@example.com',
    tokenVersion: 0,
    createdAt: new Date(0),
    ...overrides,
  };
}

describe('AuthService.login — CWE-208 timing-oracle mitigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('verifies against the real hash on a hit', async () => {
    const user = makeUser({ passwordHash: await hash('correct-horse') });
    const svc = makeService(new Map([[user.email!, user]]));

    await svc.login(user.email!, 'correct-horse');

    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith(user.passwordHash, 'correct-horse');
  });

  it('still calls verify() against a dummy hash for an unknown email (no early return)', async () => {
    const svc = makeService(new Map());

    await expect(svc.login('nobody@example.com', 'whatever')).rejects.toThrow(
      UnauthorizedException,
    );

    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('still calls verify() against a dummy hash for a passwordless (OAuth-only) account', async () => {
    const user = makeUser(); // no passwordHash — an OAuth-only/passwordless account
    const svc = makeService(new Map([[user.email!, user]]));

    await expect(svc.login(user.email!, 'whatever')).rejects.toThrow(UnauthorizedException);

    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('returns the identical error body for an unknown email and for a wrong password', async () => {
    const user = makeUser({ passwordHash: await hash('correct-horse') });
    const svc = makeService(new Map([[user.email!, user]]));

    const missErr = await svc.login('nobody@example.com', 'whatever').catch((e: unknown) => e);
    const hitErr = await svc.login(user.email!, 'wrong-password').catch((e: unknown) => e);

    expect(missErr).toBeInstanceOf(UnauthorizedException);
    expect(hitErr).toBeInstanceOf(UnauthorizedException);
    expect((missErr as UnauthorizedException).getResponse()).toEqual(
      (hitErr as UnauthorizedException).getResponse(),
    );
  });

  it('reuses a byte-identical dummy hash across two separate misses (memoized, not per-call)', async () => {
    const svc = makeService(new Map());

    await svc.login('nobody1@example.com', 'whatever').catch(() => undefined);
    await svc.login('nobody2@example.com', 'whatever').catch(() => undefined);

    const calls = vi.mocked(verify).mock.calls;
    expect(calls).toHaveLength(2);
    // Same dummy hash passed to verify() both times, proving the second miss reused the
    // memoized promise rather than recomputing hash(DUMMY_PASSWORD_SEED).
    expect(calls[0]?.[0]).toBe(calls[1]?.[0]);
  });
});
