import { Injectable } from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { env } from '../config/env';
import type {
  JwtPayload,
  WsTicketPayload,
  OauthStatePayload,
  AdminReplayTicketPayload,
} from './auth.types';
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

  signAdminReplayTicket(input: { gameId: string; actorId: string }): string {
    const payload: AdminReplayTicketPayload = { kind: 'admin-replay', ...input };
    return this.jwt.sign(payload, { expiresIn: env.adminReplayTicketTtl as Ttl });
  }

  verifyAdminReplayTicket(token: string): AdminReplayTicketPayload | null {
    try {
      const payload = this.jwt.verify<AdminReplayTicketPayload>(token);
      return payload.kind === 'admin-replay' ? payload : null;
    } catch {
      return null;
    }
  }

  signOauthState(input: Omit<OauthStatePayload, 'kind'>): string {
    const payload: OauthStatePayload = { kind: 'oauth-state', ...input };
    // jsonwebtoken treats a numeric expiresIn as seconds; derive it from the single ms source so it
    // stays in lockstep with the nonce cookie's maxAge.
    return this.jwt.sign(payload, { expiresIn: Math.floor(env.oauthStateTtlMs / 1000) });
  }

  verifyOauthState(token: string): OauthStatePayload | null {
    try {
      const payload = this.jwt.verify<OauthStatePayload>(token);
      return payload.kind === 'oauth-state' ? payload : null;
    } catch {
      return null;
    }
  }
}
