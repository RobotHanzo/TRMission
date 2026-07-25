import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * Warms `AuthService`'s login timing-oracle mitigation (CWE-208 — see `AuthService.login` /
 * `getDummyPasswordHash`) before the app accepts connections. That mitigation always runs an
 * argon2 verification against a fixed dummy hash when there's no real `passwordHash` to check,
 * so a miss (unknown email or passwordless account) costs the same as a hit — but the dummy
 * hash itself is computed lazily and memoized on first use. Without this, the very first
 * miss-path login after a process boot would pay `hash()` + `verify()` (~2x argon2 cost) while
 * every later miss pays only `verify()` against the already-memoized hash, reopening the
 * account-existence timing gap for the narrow window between boot and that first miss
 * resolving.
 *
 * `onApplicationBootstrap` runs as part of `app.init()`, which `app.listen()` always awaits to
 * completion before opening the port (see @nestjs/core's `NestApplication.listen`) — so by the
 * time the server can receive its first request, the dummy hash is already memoized. Mirrors
 * `DashboardBootstrap`'s idiom for other idempotent, nice-to-have boot-time initialization.
 * `hash()` on a hardcoded constant has no realistic failure mode short of a broken argon2
 * binary, which would also break register/login/upgrade — so, like `DashboardBootstrap`, this
 * doesn't swallow errors: a failure here should fail bootstrap loudly rather than silently ship
 * a broken argon2 setup.
 */
@Injectable()
export class AuthBootstrap implements OnApplicationBootstrap {
  constructor(private readonly auth: AuthService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.auth.warmDummyPasswordHash();
  }
}
