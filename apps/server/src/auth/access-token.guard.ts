import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TokenService } from './token.service';
import type { AuthUser } from './auth.types';

// Verifies the Bearer access token and attaches the user to the request. Lobby/game
// routes that need an identity use @UseGuards(AccessTokenGuard) + @CurrentUser().
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('missing bearer token');
    try {
      const payload = this.tokens.verifyAccess(header.slice(7));
      req.user = { userId: payload.sub, displayName: payload.name, isGuest: payload.guest };
      return true;
    } catch {
      throw new UnauthorizedException('invalid or expired token');
    }
  }
}
