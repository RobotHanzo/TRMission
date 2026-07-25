import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth.types';

/**
 * Tracks by the authenticated userId instead of source IP, so this route's cap actually
 * bounds one account's write volume instead of everyone sharing an IP (and isn't dodged by
 * rotating IPs while reusing/re-minting accounts). Applied as a METHOD-level guard on the
 * ratings submit route (after the controller's class-level AccessTokenGuard, which runs
 * first and attaches `req.user`) — class guards execute before method guards, so `req.user`
 * is always populated by the time this runs.
 */
@Injectable()
export class RatingsThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Request & { user?: AuthUser }): Promise<string> {
    return req.user?.userId ?? req.ip ?? 'unknown';
  }
}
