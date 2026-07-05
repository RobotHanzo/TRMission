import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from './auth.types';

// Gates map-authoring routes to registered accounts. Guests are TTL-expired, so a
// guest-owned map would silently vanish (and break any room hosted with it) — must run
// AFTER AccessTokenGuard, which populates req.user.
@Injectable()
export class RegisteredUserGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (req.user?.isGuest) throw new ForbiddenException('a registered account is required');
    return true;
  }
}
