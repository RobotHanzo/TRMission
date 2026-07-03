import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  effectivePermissions,
  type DashboardPermission,
  type DashboardRole,
} from '@trm/shared';
import type { AuthUser } from '../auth/auth.types';
import { DashboardAccountRepo } from './dashboard-account.repo';
import { DASHBOARD_PERMISSION_KEY } from './require-permission.decorator';

/** Attached to the request by DashboardGuard so controllers/services never re-read the repo. */
export interface DashboardActor {
  role: DashboardRole;
  permissions: Set<DashboardPermission>;
}

export type DashboardRequest = Request & { user?: AuthUser; dashboard?: DashboardActor };

/**
 * Dashboard access control. Must run AFTER AccessTokenGuard (which populates req.user).
 *
 * Response posture:
 * - 401: no/expired token (AccessTokenGuard) — drives the admin SPA's silent refresh.
 * - 404: guest, or no dashboardAccounts record — nondisclosing, mirrors the history
 *   module's "don't reveal the resource exists" convention.
 * - 403: a proven maintainer lacking this route's specific permission — disclosed so
 *   the UI can distinguish "no permission" from "not found".
 *
 * Permissions are read from Mongo on every request (one indexed point read) and never
 * embedded in tokens — revoking access is effective on the very next request.
 */
@Injectable()
export class DashboardGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accounts: DashboardAccountRepo,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<DashboardRequest>();
    const user = req.user;
    if (!user || user.isGuest) throw new NotFoundException();

    const account = await this.accounts.findById(user.userId);
    if (!account) throw new NotFoundException();

    const permissions = effectivePermissions(
      account.role,
      account.extraPermissions ?? [],
      account.deniedPermissions ?? [],
    );
    req.dashboard = { role: account.role, permissions };

    const required = this.reflector.getAllAndOverride<DashboardPermission | undefined>(
      DASHBOARD_PERMISSION_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (required && !permissions.has(required)) {
      throw new ForbiddenException(`missing dashboard permission: ${required}`);
    }
    return true;
  }
}
