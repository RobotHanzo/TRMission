import {
  BadGatewayException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { OptionalAccessTokenGuard } from '../auth/optional-access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { SentryErrorReporter } from '../observability/error-reporter';
import { apiSchema } from '../openapi/openapi';
import { SupportConfig } from './support.config';
import { SupportNotifier } from './support.notifier';
import {
  SubmitSupportDto,
  SubmitSupportSchema,
  SupportConfigSchema,
  SupportResultSchema,
} from './support.schemas';

/**
 * The public support form behind apps/web's `/support` page — the URL App Store Connect and Play
 * point at (issue #80, Apple guideline 1.5). **Deliberately open to anonymous callers**: someone
 * who cannot sign in is exactly the person who most needs to reach support, so requiring a token
 * here would defeat the page's purpose. A token that IS present is honoured (OptionalAccessTokenGuard)
 * and the account is stamped onto the message, which is the part a maintainer can act on.
 *
 * Being unauthenticated makes the rate limit the only thing standing between the form and the
 * maintainers' Discord, so it is much tighter than the global cap and tracked by source IP (the
 * global ThrottlerGuard's default tracker) rather than by account.
 */
@ApiTags('support')
@Controller('api/v1/support')
export class SupportController {
  constructor(
    private readonly config: SupportConfig,
    private readonly notifier: SupportNotifier,
    private readonly reporter: SentryErrorReporter,
  ) {}

  @Get('config')
  @ApiOperation({ summary: 'Whether the support form can currently accept messages' })
  @ApiResponse({ status: 200, schema: apiSchema(SupportConfigSchema) })
  supportConfig(): { formEnabled: boolean } {
    return { formEnabled: this.config.formEnabled };
  }

  @Post()
  @HttpCode(201)
  @UseGuards(OptionalAccessTokenGuard)
  @ApiBearerAuth('access-token')
  // Guards run before the validation pipe, so a rejected body spends quota too — hence 10 rather
  // than the handful a genuine sender needs.
  @Throttle({ default: { limit: 10, ttl: 10 * 60_000 } })
  @ApiOperation({ summary: 'Submit a support request (no account required)' })
  @ApiBody({ schema: apiSchema(SubmitSupportSchema) })
  @ApiResponse({ status: 201, schema: apiSchema(SupportResultSchema) })
  async submit(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: SubmitSupportDto,
  ): Promise<{ delivered: boolean }> {
    // No webhook configured ⇒ there is no inbox at all. Say so instead of accepting the message
    // and dropping it; the page falls back to the e-mail address and the Discord invite.
    if (!this.notifier.enabled) {
      throw new ServiceUnavailableException('the support form is not available on this deployment');
    }
    try {
      await this.notifier.supportRequest({
        category: body.category,
        subject: body.subject,
        message: body.message,
        ...(body.email ? { email: body.email } : {}),
        ...(body.name ? { name: body.name } : {}),
        ...(body.platform ? { platform: body.platform } : {}),
        ...(body.appVersion ? { appVersion: body.appVersion } : {}),
        sender: user
          ? { userId: user.userId, displayName: user.displayName, isGuest: user.isGuest }
          : {},
      });
    } catch (err) {
      // The webhook is the only store, so a failure here means the message is GONE. Report it and
      // tell the sender, rather than returning a 201 they would reasonably read as "received".
      this.reporter.capture(err, 'support.webhook', { kind: 'support' });
      throw new BadGatewayException('could not deliver your message — please try the alternatives');
    }
    return { delivered: true };
  }
}
