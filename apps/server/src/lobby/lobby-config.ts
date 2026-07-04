import { Injectable, Optional } from '@nestjs/common';
import { env } from '../config/env';

/** Test-only overrides so specs can flip the flag without mutating frozen `env`. */
export interface LobbyConfigOverrides {
  randomEvents?: boolean;
}

/**
 * Injectable source of truth for lobby-level feature flags (the auth-config.ts pattern): Nest
 * instantiates it with no args (env-driven); tests bind `new LobbyConfig(overrides)` via
 * `.overrideProvider(LobbyConfig).useValue(...)` to exercise the on/off permutations.
 *
 * `randomEvents` gates the per-room events option. It defaults OFF, and the server ENFORCES it
 * (rejects a settings PATCH that turns it on, downgrades to 'off' at start) — the UI hint from
 * `GET /rooms/config` is never trusted on its own.
 */
@Injectable()
export class LobbyConfig {
  readonly randomEvents: boolean;

  constructor(@Optional() overrides?: LobbyConfigOverrides) {
    this.randomEvents = overrides?.randomEvents ?? env.randomEvents;
  }
}
