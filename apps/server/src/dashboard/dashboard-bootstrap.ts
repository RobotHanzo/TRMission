import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { UserRepo } from '../auth/user.repo';
import { DashboardConfig } from './dashboard-config';
import { DashboardAccountRepo } from './dashboard-account.repo';
import { AuditService } from './audit.service';

/**
 * Seeds the `owner` dashboard role for the accounts named in DASHBOARD_OWNER_IDS.
 * Runs on every boot and is idempotent: an audit entry is written only when the
 * record actually changed (created, or healed back to owner). Env is authoritative
 * at boot — an accidentally demoted env-owner is restored by a restart. Ids with
 * no registered account are skipped with a warning (register first, then restart).
 *
 * Seeded by `users._id`, NOT email: `POST /auth/register`/`upgrade` let any anonymous
 * caller claim an arbitrary, unverified email, so matching on email would let whoever
 * registers a configured address first (e.g. the maintainer's publicly-known email,
 * before the maintainer themselves registers) be auto-granted owner. A `users._id`
 * is a server-minted random id the caller never gets to choose, so only the exact
 * account the operator configured is ever eligible for the grant.
 */
@Injectable()
export class DashboardBootstrap implements OnApplicationBootstrap {
  private readonly log = new Logger(DashboardBootstrap.name);

  constructor(
    private readonly config: DashboardConfig,
    private readonly users: UserRepo,
    private readonly accounts: DashboardAccountRepo,
    private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const id of this.config.ownerIds) {
      const user = await this.users.findById(id);
      if (!user || user.isGuest) {
        this.log.warn(`DASHBOARD_OWNER_IDS: no registered account for ${id}; skipped`);
        continue;
      }
      const existing = await this.accounts.findById(user._id);
      if (existing?.role === 'owner') continue; // already owner — nothing to do, no audit spam
      await this.accounts.upsert(user._id, { role: 'owner' }, 'system:env');
      await this.audit.logSystem(
        'bootstrap.grant',
        { type: 'maintainer', id: user._id },
        { previousRole: existing?.role ?? null },
      );
      this.log.log(`dashboard owner seeded: ${id}`);
    }
  }
}
