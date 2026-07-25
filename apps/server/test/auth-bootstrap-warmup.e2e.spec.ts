import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { hash } from '@node-rs/argon2';
import { createTestApp, type TestApp } from './app';

// Real argon2, spied rather than replaced, so this stays a genuine integration test of the
// DI wiring (AuthModule's AuthBootstrap → AuthService.warmDummyPasswordHash) instead of one
// that merely exercises a stub. Declared in its own file so vitest's per-file module
// isolation (see vitest.config.ts's `pool: 'forks'`) gives it a pristine, never-touched
// `dummyPasswordHash` module state — no earlier test in this process can have memoized it.
vi.mock('@node-rs/argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@node-rs/argon2')>();
  return { ...actual, hash: vi.fn(actual.hash) };
});

describe('auth bootstrap: login timing-oracle dummy-hash warm-up (CWE-208)', () => {
  it('memoizes the dummy hash during app.init(), before any request is ever made', async () => {
    expect(vi.mocked(hash)).not.toHaveBeenCalled();

    // createTestApp() (test/app.ts) mirrors main.ts's own boot sequence up through
    // `await app.init()`. Nest's `init()` runs every provider's `onApplicationBootstrap`
    // hook — including the new `AuthBootstrap` — to completion before resolving, and in
    // production `app.listen()` always awaits that same `init()` before opening the port
    // (@nestjs/core's `NestApplication.listen`), so this is the identical ordering
    // guarantee main.ts relies on. No HTTP request has been made yet at this point.
    const t: TestApp = await createTestApp();
    try {
      // Warmed eagerly at boot — not left to the first miss-path login to compute lazily.
      expect(vi.mocked(hash)).toHaveBeenCalledTimes(1);

      // The very first real request — a miss (unknown email) — must reuse that
      // already-memoized dummy hash rather than recomputing it: hash() stays called
      // exactly once, proving the boot-time warm-up closes the lazy-first-request window
      // the round-2 re-challenge found (a fresh process's first miss otherwise pays
      // hash()+verify(), ~2x argon2 cost, instead of the ~1x every later miss/hit pays).
      await request(t.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: 'whatever123' })
        .expect(401);

      expect(vi.mocked(hash)).toHaveBeenCalledTimes(1);
    } finally {
      await t.close();
    }
  }, 30_000);
});
