import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { DashboardGuard } from './dashboard.guard';
import { RequirePermission } from './require-permission.decorator';
import { DashboardPushService } from './dashboard-push.service';
import {
  PushStatusSchema,
  PushTestRequestDto,
  PushTestRequestSchema,
  PushTestResultSchema,
} from './dashboard.schemas';

@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard, DashboardGuard)
@Controller('api/v1/dashboard/push')
export class DashboardPushController {
  constructor(private readonly service: DashboardPushService) {}

  @Get('status')
  @RequirePermission('push.test')
  @ApiOperation({ summary: 'Whether a push transport (FCM/APNs) is configured' })
  @ApiResponse({ status: 200, schema: apiSchema(PushStatusSchema) })
  status() {
    return this.service.status();
  }

  @Post('test')
  @HttpCode(200)
  @RequirePermission('push.test')
  @ApiOperation({
    summary: "Send a real push notification to one account's registered device(s)",
    description:
      'Fires the same localized copy a real game event would, through the real FCM/APNs ' +
      'transports — for verifying the push pipeline without staging a whole game. Reports ' +
      'device count / sent / failed rather than the fire-and-forget behavior game events use.',
  })
  @ApiBody({ schema: apiSchema(PushTestRequestSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(PushTestResultSchema) })
  test(@CurrentUser() actor: AuthUser, @Body() body: PushTestRequestDto) {
    return this.service.sendTest(actor, body.userId, body.kind);
  }
}
