// The two REST surfaces of server OTA (docs/release/server-ota.md).
//
// GET  status — unauthenticated on purpose. It is what CI reads to decide OTA vs image pull, and CI
//               holds no deployment credential. Everything it returns is already public for a public
//               repo (commit hashes) or a hash of public files (the fence); no secret, no game state.
// POST check  — CI's "look now" nudge, so a deploy lands in ~1s instead of waiting for the poll.
//               Guarded by a shared secret, but note what it can and cannot do: it triggers a check.
//               The code that gets applied is authorised by the manifest SIGNATURE, so a leaked token
//               buys an early poll and nothing else.
import { Controller, ForbiddenException, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';
import {
  SelfUpdateService,
  type SelfUpdateResult,
  type SelfUpdateStatus,
} from './selfupdate.service';

/** Constant-time compare that tolerates length differences without leaking them through timing. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.byteLength !== b.byteLength) {
    // Still do a compare so the failure path costs the same as a same-length mismatch.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

@ApiTags('system')
@Controller('api/v1/selfupdate')
export class SelfUpdateController {
  constructor(private readonly selfUpdate: SelfUpdateService) {}

  @Get('status')
  @ApiOperation({
    summary: 'What this deployment is running, and whether an OTA can carry the next update',
  })
  status(): SelfUpdateStatus {
    return this.selfUpdate.status();
  }

  @Post('check')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Check the manifest now (CI post-publish nudge; shared-secret guarded)',
  })
  async check(
    @Headers('x-trm-selfupdate-token') token: string | undefined,
  ): Promise<{ result: SelfUpdateResult; status: SelfUpdateStatus }> {
    if (
      env.selfUpdateWebhookSecret === '' ||
      !secretMatches(token ?? '', env.selfUpdateWebhookSecret)
    ) {
      throw new ForbiddenException();
    }
    const result = await this.selfUpdate.check();
    return { result, status: this.selfUpdate.status() };
  }
}
