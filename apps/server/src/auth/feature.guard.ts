import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { UserFeature } from '@trm/shared';
import type { AuthUser } from './auth.types';
import { UserRepo } from './user.repo';
import { REQUIRE_FEATURE_KEY } from './require-feature.decorator';

/** Stable 403 body the web client maps to an i18n message. */
export const featureDisabled = (feature: UserFeature): ForbiddenException =>
  new ForbiddenException({
    message: `feature not enabled: ${feature}`,
    code: 'FEATURE_DISABLED',
    feature,
  });

/**
 * Per-account feature gate. Must run AFTER AccessTokenGuard (needs req.user).
 * Reads the user doc on every request (one indexed point read) so a dashboard
 * grant/revoke applies instantly — same posture as ban enforcement, never token claims.
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly users: UserRepo,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<UserFeature | undefined>(
      REQUIRE_FEATURE_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required) return true;
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!req.user) throw featureDisabled(required); // AccessTokenGuard should have run first
    if (!(await this.users.hasFeature(req.user.userId, required))) {
      throw featureDisabled(required);
    }
    return true;
  }
}
