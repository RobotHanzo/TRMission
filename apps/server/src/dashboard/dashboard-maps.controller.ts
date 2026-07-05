import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { DashboardGuard } from './dashboard.guard';
import { RequirePermission } from './require-permission.decorator';
import { DashboardMapsService } from './dashboard-maps.service';
import { MapAdminDetailSchema, MapsListSchema } from './dashboard.schemas';

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
}
