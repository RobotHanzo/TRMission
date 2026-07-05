import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TokenService } from '../auth/token.service';
import type { AdminReplayTicketPayload } from '../auth/auth.types';

/**
 * Verifies a `?ticket=` query param minted by `POST /dashboard/games/:id/replay-ticket`.
 * No AccessTokenGuard runs alongside this — the ticket itself (scoped to one gameId,
 * short-lived) is the sole authority, same posture as the ws-game ticket handoff.
 */
@Injectable()
export class AdminReplayTicketGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { adminReplay?: AdminReplayTicketPayload }>();
    const ticket = req.query.ticket;
    if (typeof ticket !== 'string') throw new NotFoundException('replay not available');
    const payload = this.tokens.verifyAdminReplayTicket(ticket);
    if (!payload || payload.gameId !== req.params.gameId) {
      throw new NotFoundException('replay not available');
    }
    req.adminReplay = payload;
    return true;
  }
}
