import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { effectivePermissions } from '@trm/shared';
import { TokenService } from '../auth/token.service';
import type { AdminReplayTicketPayload, AuthUser } from '../auth/auth.types';
import { DashboardAccountRepo } from '../dashboard/dashboard-account.repo';

/**
 * Verifies an `x-trm-admin-ticket` header minted by `POST /dashboard/games/:id/replay-ticket`.
 * The ticket alone is no longer the sole authority (it used to ride as a `?ticket=` query
 * param, logged by proxies/CDNs and kept in browser history — the header keeps it out of
 * those channels): this guard must run AFTER AccessTokenGuard, and additionally requires
 * (1) the presenting session to be the exact maintainer the ticket was minted for
 * (`payload.actorId === req.user.userId`), and (2) that maintainer to CURRENTLY hold
 * `games.viewReplay` — dashboardAccounts is re-read per request, the same posture
 * DashboardGuard uses, so an access revocation between mint and use takes effect
 * immediately instead of waiting out the ticket's TTL.
 */
@Injectable()
export class AdminReplayTicketGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly accounts: DashboardAccountRepo,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser; adminReplay?: AdminReplayTicketPayload }>();
    const header = req.headers['x-trm-admin-ticket'];
    const ticket = Array.isArray(header) ? header[0] : header;
    if (typeof ticket !== 'string') throw new NotFoundException('replay not available');
    const payload = this.tokens.verifyAdminReplayTicket(ticket);
    if (!payload || payload.gameId !== req.params.gameId) {
      throw new NotFoundException('replay not available');
    }
    if (!req.user || req.user.userId !== payload.actorId) {
      throw new NotFoundException('replay not available');
    }
    const account = await this.accounts.findById(payload.actorId);
    const permissions = account
      ? effectivePermissions(account.role, account.extraPermissions, account.deniedPermissions)
      : new Set<string>();
    if (!permissions.has('games.viewReplay')) {
      throw new NotFoundException('replay not available');
    }
    req.adminReplay = payload;
    return true;
  }
}
