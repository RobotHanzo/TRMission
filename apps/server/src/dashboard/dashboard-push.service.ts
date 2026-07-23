import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { PushService, type PushKind } from '../push/push.service';
import { AuditService } from './audit.service';

/**
 * Dashboard wrapper around the general-purpose `PushService` (owned by `src/push/`, used by
 * the hub/lobby for real game events): adds the `push.test` audit trail without leaking a
 * dashboard concern into the core push module.
 */
@Injectable()
export class DashboardPushService {
  constructor(
    private readonly push: PushService,
    private readonly audit: AuditService,
  ) {}

  status(): { enabled: boolean } {
    return { enabled: this.push.enabled };
  }

  async sendTest(
    actor: AuthUser,
    userId: string,
    kind: PushKind,
  ): Promise<{ enabled: boolean; deviceCount: number; sent: number; failed: number }> {
    const result = await this.push.sendTest(userId, kind);
    await this.audit.log(actor, 'push.test', { type: 'user', id: userId }, { kind, ...result });
    return result;
  }
}
