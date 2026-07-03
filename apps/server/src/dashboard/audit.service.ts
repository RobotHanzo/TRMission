import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import {
  DashboardAuditRepo,
  type AuditEntryDoc,
  type AuditTarget,
  type DashboardAuditAction,
} from './audit.repo';

/**
 * Write API for the dashboard audit log. Called explicitly by each mutating service
 * method AFTER its mutation succeeds (the log records what happened, not what was
 * attempted). A failed audit write throws: a moderation action without an audit
 * record is worse than making the operator retry.
 */
@Injectable()
export class AuditService {
  constructor(private readonly repo: DashboardAuditRepo) {}

  log(
    actor: Pick<AuthUser, 'userId' | 'displayName'>,
    action: DashboardAuditAction,
    target?: AuditTarget,
    params?: Record<string, unknown>,
  ): Promise<AuditEntryDoc> {
    return this.repo.append({
      actorId: actor.userId,
      actorName: actor.displayName,
      action,
      ...(target ? { target } : {}),
      ...(params ? { params } : {}),
    });
  }

  /** System-actor variant for boot seeding. */
  logSystem(
    action: DashboardAuditAction,
    target?: AuditTarget,
    params?: Record<string, unknown>,
  ): Promise<AuditEntryDoc> {
    return this.repo.append({
      actorId: 'system:env',
      actorName: 'system',
      action,
      ...(target ? { target } : {}),
      ...(params ? { params } : {}),
    });
  }
}
