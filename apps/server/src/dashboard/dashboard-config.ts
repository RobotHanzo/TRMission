import { Injectable, Optional } from '@nestjs/common';
import { env } from '../config/env';

/** Test-only overrides so specs can exercise bootstrap without mutating frozen `env`. */
export interface DashboardConfigOverrides {
  ownerIds?: string[];
}

/**
 * Injectable source of truth for dashboard bootstrap configuration (auth-config.ts pattern):
 * Nest instantiates it with no args (env-driven); tests bind `new DashboardConfig(overrides)`
 * via `.overrideProvider(...).useValue(...)`.
 */
@Injectable()
export class DashboardConfig {
  /** `users._id` values granted the `owner` role at boot. Not emails — see env.ts. */
  readonly ownerIds: readonly string[];

  constructor(@Optional() overrides?: DashboardConfigOverrides) {
    this.ownerIds = (overrides?.ownerIds ?? env.dashboardOwnerIds).map((id) => id.trim());
  }
}
