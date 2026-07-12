import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { UserRepo } from '../auth/user.repo';
import { CustomMapRepo } from '../maps/custom-map.repo';
import { apiSchema } from '../openapi/openapi';
import { ReportRepo } from './report.repo';
import {
  ReportCreatedSchema,
  ReportMapDto,
  ReportMapSchema,
  ReportPlayerDto,
  ReportPlayerSchema,
} from './moderation.schemas';
import type { AuthUser } from '../auth/auth.types';

/**
 * UGC abuse reporting (Apple 1.2 / Play UGC). Open to every authenticated account,
 * guests included. Map reporting is deliberately OUTSIDE the mapBuilder feature gate:
 * anyone holding a share code must be able to report its content — the code itself is
 * the capability, the same posture as GET /maps/content/:hash.
 */
@ApiTags('moderation')
@Controller('api/v1/reports')
@UseGuards(AccessTokenGuard)
@ApiBearerAuth('access-token')
export class ReportsController {
  constructor(
    private readonly reports: ReportRepo,
    private readonly users: UserRepo,
    private readonly maps: CustomMapRepo,
  ) {}

  @Post('player')
  @HttpCode(201)
  @ApiOperation({ summary: 'Report a player (harassment, cheating, inappropriate name, …)' })
  @ApiBody({ schema: apiSchema(ReportPlayerSchema) })
  @ApiResponse({ status: 201, schema: apiSchema(ReportCreatedSchema) })
  async reportPlayer(@CurrentUser() user: AuthUser, @Body() body: ReportPlayerDto) {
    if (body.userId === user.userId) throw new BadRequestException('cannot report yourself');
    const target = await this.users.findById(body.userId);
    if (!target) throw new NotFoundException('user not found');
    const doc = await this.reports.create({
      kind: 'player',
      category: body.category,
      ...(body.message ? { message: body.message } : {}),
      reporterId: user.userId,
      reporterName: user.displayName,
      reportedUserId: target._id,
      reportedName: target.displayName,
      ...(body.gameId ? { gameId: body.gameId } : {}),
      ...(body.roomCode ? { roomCode: body.roomCode } : {}),
    });
    return { id: doc._id.toHexString() };
  }

  @Post('map')
  @HttpCode(201)
  @ApiOperation({ summary: 'Report a shared custom map by its share code' })
  @ApiBody({ schema: apiSchema(ReportMapSchema) })
  @ApiResponse({ status: 201, schema: apiSchema(ReportCreatedSchema) })
  async reportMap(@CurrentUser() user: AuthUser, @Body() body: ReportMapDto) {
    const map = await this.maps.findByShareCode(body.shareCode);
    if (!map) throw new NotFoundException('map not found');
    const doc = await this.reports.create({
      kind: 'map',
      category: body.category,
      ...(body.message ? { message: body.message } : {}),
      reporterId: user.userId,
      reporterName: user.displayName,
      mapId: map._id,
      mapOwnerId: map.ownerId,
      shareCode: body.shareCode,
      mapNameZh: map.nameZh,
      mapNameEn: map.nameEn,
    });
    return { id: doc._id.toHexString() };
  }
}
