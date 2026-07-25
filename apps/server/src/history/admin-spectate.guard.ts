import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { effectivePermissions } from '@trm/shared';
import { TokenService } from '../auth/token.service';
import type { AuthUser, WsTicketPayload } from '../auth/auth.types';
import { DashboardAccountRepo } from '../dashboard/dashboard-account.repo';

/**
 * Verifies an `x-trm-admin-ticket` header against the SAME ws-game ticket kind a real
 * spectator gets (kind: 'ws-game', seat: -1) — reused here purely to resolve player display
 * names for the ticket-only /admin-spectate web route; the live game state itself streams
 * over the WebSocket using this identical ticket presented in the first `ClientHello` frame
 * (a structurally different, already session-less-by-design handoff shared by every
 * player/spectator — out of scope here).
 *
 * This HTTP roster route, however, used to accept the ticket as a `?ticket=` query param —
 * logged by proxies/CDNs and kept in browser history, the same leak vector as the admin-replay
 * ticket. It now requires a header (this guard must run AFTER AccessTokenGuard) plus (1) the
 * presenting session to be the exact maintainer the ticket was minted for
 * (`payload.playerId === req.user.userId`) and (2) that maintainer to CURRENTLY hold
 * `games.spectateLive`, re-read from dashboardAccounts per request (the same posture
 * DashboardGuard uses) so a mid-window access revocation is instant.
 */
@Injectable()
export class AdminSpectateTicketGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly accounts: DashboardAccountRepo,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser; spectateTicket?: WsTicketPayload }>();
    const header = req.headers['x-trm-admin-ticket'];
    const ticket = Array.isArray(header) ? header[0] : header;
    if (typeof ticket !== 'string') throw new NotFoundException('spectate info not available');
    const payload = this.tokens.verifyWsTicket(ticket);
    if (!payload || payload.gameId !== req.params.gameId || payload.seat !== -1) {
      throw new NotFoundException('spectate info not available');
    }
    if (!req.user || req.user.userId !== payload.playerId) {
      throw new NotFoundException('spectate info not available');
    }
    const account = await this.accounts.findById(payload.playerId);
    const permissions = account
      ? effectivePermissions(account.role, account.extraPermissions, account.deniedPermissions)
      : new Set<string>();
    if (!permissions.has('games.spectateLive')) {
      throw new NotFoundException('spectate info not available');
    }
    req.spectateTicket = payload;
    return true;
  }
}
