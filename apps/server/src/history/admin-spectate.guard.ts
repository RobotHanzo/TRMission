import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TokenService } from '../auth/token.service';
import type { WsTicketPayload } from '../auth/auth.types';

/**
 * Verifies a `?ticket=` query param against the SAME ws-game ticket kind a real spectator gets
 * (kind: 'ws-game', seat: -1) — reused here purely to resolve player display names for the
 * ticket-only /admin-spectate web route; the live game state itself streams over the WebSocket
 * using this identical ticket. Any valid spectator ticket for this game passes (not
 * dashboard-exclusive): display names are not hidden information, so there is nothing to gate
 * more tightly than "holds a valid spectator ticket for this exact game".
 */
@Injectable()
export class AdminSpectateTicketGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { spectateTicket?: WsTicketPayload }>();
    const ticket = req.query.ticket;
    if (typeof ticket !== 'string') throw new NotFoundException('spectate info not available');
    const payload = this.tokens.verifyWsTicket(ticket);
    if (!payload || payload.gameId !== req.params.gameId || payload.seat !== -1) {
      throw new NotFoundException('spectate info not available');
    }
    req.spectateTicket = payload;
    return true;
  }
}
