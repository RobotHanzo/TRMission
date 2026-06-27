import { Injectable } from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { env } from '../config/env';
import type { JwtPayload, WsTicketPayload } from './auth.types';
import type { UserDoc } from './user.repo';

type Ttl = NonNullable<JwtSignOptions['expiresIn']>;

// All JWT signing/verification. Access tokens authenticate REST calls; ws-game tickets
// (short-lived) hand a player off from the REST lobby to the WebSocket gateway (A8).
@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  signAccess(user: UserDoc): string {
    const payload: JwtPayload = {
      sub: user._id,
      name: user.displayName,
      guest: user.isGuest,
      tv: user.tokenVersion,
    };
    return this.jwt.sign(payload, { expiresIn: env.accessTtl as Ttl });
  }

  verifyAccess(token: string): JwtPayload {
    return this.jwt.verify<JwtPayload>(token);
  }

  signWsTicket(input: { gameId: string; playerId: string; seat: number }): string {
    const payload: WsTicketPayload = { kind: 'ws-game', ...input };
    return this.jwt.sign(payload, { expiresIn: env.wsTicketTtl as Ttl });
  }

  verifyWsTicket(token: string): WsTicketPayload | null {
    try {
      const payload = this.jwt.verify<WsTicketPayload>(token);
      return payload.kind === 'ws-game' ? payload : null;
    } catch {
      return null;
    }
  }
}
