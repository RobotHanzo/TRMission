import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { DashboardGuard } from './dashboard.guard';
import { RequirePermission } from './require-permission.decorator';
import { DashboardMapsService } from './dashboard-maps.service';
import {
  MapAdminDetailSchema,
  MapsListSchema,
  ModerationReasonDto,
  ModerationReasonSchema,
  TransferMapDto,
  TransferMapSchema,
} from './dashboard.schemas';

const MapsListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(300).optional(),
});
class MapsListQueryDto extends createZodDto(MapsListQuerySchema) {}

@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard, DashboardGuard)
@Controller('api/v1/dashboard')
export class DashboardMapsController {
  constructor(private readonly maps: DashboardMapsService) {}

  @Get('maps')
  @RequirePermission('maps.read')
  @ApiOperation({ summary: 'List custom maps across all owners, most recently updated first' })
  @ApiResponse({ status: 200, schema: apiSchema(MapsListSchema) })
  listMaps(@Query() query: MapsListQueryDto) {
    return this.maps.listMaps(query);
  }

  @Get('maps/:id')
  @RequirePermission('maps.read')
  @ApiOperation({ summary: 'One custom map: owner, draft content, share status, usage count' })
  @ApiResponse({ status: 200, schema: apiSchema(MapAdminDetailSchema) })
  mapDetail(@Param('id') id: string) {
    return this.maps.mapDetail(id);
  }

  @Delete('maps/:id')
  @HttpCode(204)
  @RequirePermission('maps.moderate')
  @ApiOperation({
    summary: 'Hard-delete a custom map (any owner). Published content is unaffected.',
  })
  @ApiBody({ schema: apiSchema(ModerationReasonSchema) })
  deleteMap(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Body() body: ModerationReasonDto,
  ) {
    return this.maps.deleteMap(actor, id, body.reason);
  }

  @Delete('maps/:id/share')
  @HttpCode(204)
  @RequirePermission('maps.moderate')
  @ApiOperation({ summary: "Force-revoke a custom map's share code (any owner)" })
  @ApiBody({ schema: apiSchema(ModerationReasonSchema) })
  unshareMap(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Body() body: ModerationReasonDto,
  ) {
    return this.maps.unshareMap(actor, id, body.reason);
  }

  @Post('maps/:id/transfer')
  @HttpCode(200)
  @RequirePermission('maps.moderate')
  @ApiOperation({ summary: 'Reassign a custom map to a different owner' })
  @ApiBody({ schema: apiSchema(TransferMapSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(MapAdminDetailSchema) })
  transferMap(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Body() body: TransferMapDto,
  ) {
    return this.maps.transferMap(actor, id, body.newOwnerId);
  }
}
