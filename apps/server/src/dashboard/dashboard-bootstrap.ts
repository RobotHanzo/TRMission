import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { UserRepo } from '../auth/user.repo';
import { DashboardConfig } from './dashboard-config';
import { DashboardAccountRepo } from './dashboard-account.repo';
import { AuditService } from './audit.service';

/**
 * Seeds the `owner` dashboard role for the accounts named in DASHBOARD_OWNER_EMAILS.
 * Runs on every boot and is idempotent: an audit entry is written only when the
 * record actually changed (created, or healed back to owner). Env is authoritative
 * at boot — an accidentally demoted env-owner is restored by a restart. Emails with
 * no registered account are skipped with a warning (register first, then restart).
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
    for (const email of this.config.ownerEmails) {
      const user = await this.users.findByEmail(email);
      if (!user || user.isGuest) {
        this.log.warn(`DASHBOARD_OWNER_EMAILS: no registered account for ${email}; skipped`);
        continue;
      }
      const existing = await this.accounts.findById(user._id);
      if (existing?.role === 'owner') continue; // already owner — nothing to do, no audit spam
      await this.accounts.upsert(user._id, { role: 'owner' }, 'system:env');
      await this.audit.logSystem(
        'bootstrap.grant',
        { type: 'maintainer', id: user._id },
        { email, previousRole: existing?.role ?? null },
      );
      this.log.log(`dashboard owner seeded: ${email}`);
    }
  }
}
