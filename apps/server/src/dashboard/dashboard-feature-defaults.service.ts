import { Injectable } from '@nestjs/common';
import type { UserFeature } from '@trm/shared';
import type { AuthUser } from '../auth/auth.types';
import { FeatureDefaultsRepo } from '../auth/feature-defaults.repo';
import { AuditService } from './audit.service';

/** Backs `GET/PUT /dashboard/config/features` (permission `config.features`) — the global
 *  default feature set every account gets on top of its own explicit grants. */
@Injectable()
export class DashboardFeatureDefaultsService {
  constructor(
    private readonly defaults: FeatureDefaultsRepo,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<{ features: UserFeature[] }> {
    return { features: await this.defaults.get() };
  }

  async set(actor: AuthUser, features: UserFeature[]): Promise<{ features: UserFeature[] }> {
    const before = await this.defaults.get();
    const deduped = [...new Set(features)];
    const after = await this.defaults.set(deduped);
    await this.audit.log(actor, 'config.features', undefined, { before, after });
    return { features: after };
  }
}
