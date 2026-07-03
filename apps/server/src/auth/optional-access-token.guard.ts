import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TokenService } from './token.service';
import type { AuthUser } from './auth.types';

// Like AccessTokenGuard, but a MISSING token is allowed through as an anonymous request
// (req.user stays undefined) — for routes whose resource decides its own access (e.g. a
// view-by-link replay). A token that is present but bad still 401s, so an expired session
// surfaces to the client's silent-refresh path instead of silently downgrading to anonymous.
@Injectable()
export class OptionalAccessTokenGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return true;
    try {
      const payload = this.tokens.verifyAccess(header.slice(7));
      req.user = { userId: payload.sub, displayName: payload.name, isGuest: payload.guest };
      return true;
    } catch {
      throw new UnauthorizedException('invalid or expired token');
    }
  }
}
