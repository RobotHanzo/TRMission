import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from './auth.types';
import { UserRepo } from './user.repo';

/**
 * Closes the write-side gap in the documented ban posture (see apps/server/CLAUDE.md's
 * "Ban" section): AccessTokenGuard is deliberately left unchanged so an already-issued
 * access token keeps read-only REST access for the rest of its TTL. Routes that MUTATE
 * state on behalf of the caller — and would otherwise let a just-banned account keep
 * writing for up to JWT_ACCESS_TTL — compose this guard AFTER AccessTokenGuard so it can
 * reject once `UserDoc.disabledAt` is set. One indexed point read per request, same
 * cost/posture as FeatureGuard's per-request feature check; never apply to GET routes,
 * which are the intentionally-preserved read-only window.
 */
@Injectable()
export class ActiveAccountGuard implements CanActivate {
  constructor(private readonly users: UserRepo) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!req.user) throw new UnauthorizedException('invalid or expired token'); // AccessTokenGuard should have run first
    if (await this.users.isDisabled(req.user.userId)) {
      throw new UnauthorizedException('account disabled');
    }
    return true;
  }
}
