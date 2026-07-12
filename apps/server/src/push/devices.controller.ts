import { Body, Controller, Delete, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { apiSchema } from '../openapi/openapi';
import { DeviceRepo } from './device.repo';
import {
  RegisterDeviceDto,
  RegisterDeviceSchema,
  RemoveDeviceDto,
  RemoveDeviceSchema,
} from './push.schemas';
import type { AuthUser } from '../auth/auth.types';

@ApiTags('push')
@Controller('api/v1/me/devices')
@UseGuards(AccessTokenGuard)
@ApiBearerAuth('access-token')
export class DevicesController {
  constructor(private readonly devices: DeviceRepo) {}

  @Post()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Register this device for push (idempotent; token follows the account)',
  })
  @ApiBody({ schema: apiSchema(RegisterDeviceSchema) })
  async register(@CurrentUser() user: AuthUser, @Body() body: RegisterDeviceDto): Promise<void> {
    await this.devices.upsert(user.userId, body.platform, body.token);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Unregister a device token (sign-out / notifications toggled off)' })
  @ApiBody({ schema: apiSchema(RemoveDeviceSchema) })
  async remove(@CurrentUser() user: AuthUser, @Body() body: RemoveDeviceDto): Promise<void> {
    await this.devices.removeForUser(user.userId, body.token);
  }
}
