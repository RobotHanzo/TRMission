import { Injectable, Optional } from '@nestjs/common';
import { env } from '../config/env';

/** Test-only overrides so specs can exercise bootstrap without mutating frozen `env`. */
export interface DashboardConfigOverrides {
  ownerEmails?: string[];
}

/**
 * Injectable source of truth for dashboard bootstrap configuration (auth-config.ts pattern):
 * Nest instantiates it with no args (env-driven); tests bind `new DashboardConfig(overrides)`
 * via `.overrideProvider(...).useValue(...)`.
 */
@Injectable()
export class DashboardConfig {
  /** Emails granted the `owner` role at boot (lowercased). */
  readonly ownerEmails: readonly string[];

  constructor(@Optional() overrides?: DashboardConfigOverrides) {
    this.ownerEmails = (overrides?.ownerEmails ?? env.dashboardOwnerEmails).map((e) =>
      e.trim().toLowerCase(),
    );
  }
}
