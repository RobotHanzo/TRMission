import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { MapsService } from './maps.service';
import {
  CreateMapDto,
  CreateMapSchema,
  draftFromDto,
  MapContentResponseSchema,
  MapDetailSchema,
  MapSummarySchema,
  ShareResultSchema,
  SharedMapViewSchema,
  UpdateMapDto,
  UpdateMapSchema,
} from './maps.schemas';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { RegisteredUserGuard } from '../auth/registered-user.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';

@ApiTags('maps')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard)
@Controller('api/v1/maps')
export class MapsController {
  constructor(private readonly maps: MapsService) {}

  @Get()
  @ApiOperation({ summary: 'List your custom maps' })
  @ApiResponse({ status: 200, schema: apiSchema(z.array(MapSummarySchema)) })
  list(@CurrentUser() user: AuthUser) {
    return this.maps.list(user.userId);
  }

  @Post()
  @UseGuards(RegisteredUserGuard)
  @ApiOperation({ summary: 'Create a new, empty custom map draft (registered accounts only)' })
  @ApiBody({ schema: apiSchema(CreateMapSchema) })
  @ApiResponse({ status: 201, schema: apiSchema(MapDetailSchema) })
  create(@CurrentUser() user: AuthUser, @Body() body: CreateMapDto) {
    return this.maps.create(user.userId, body.nameZh, body.nameEn);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one of your custom maps (full draft)' })
  @ApiResponse({ status: 200, schema: apiSchema(MapDetailSchema) })
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.maps.get(id, user.userId);
  }

  @Put(':id')
  @UseGuards(RegisteredUserGuard)
  @ApiOperation({ summary: 'Update a custom map (name and/or draft content)' })
  @ApiBody({ schema: apiSchema(UpdateMapSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(MapDetailSchema) })
  update(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() body: UpdateMapDto) {
    return this.maps.update(id, user.userId, {
      ...(body.nameZh !== undefined ? { nameZh: body.nameZh } : {}),
      ...(body.nameEn !== undefined ? { nameEn: body.nameEn } : {}),
      ...(body.draft !== undefined ? { draft: draftFromDto(body.draft) } : {}),
    });
  }

  @Delete(':id')
  @UseGuards(RegisteredUserGuard)
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a custom map' })
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.maps.remove(id, user.userId);
  }

  @Post(':id/share')
  @UseGuards(RegisteredUserGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Mint (or re-fetch) a share code for a custom map' })
  @ApiResponse({ status: 200, schema: apiSchema(ShareResultSchema) })
  share(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.maps.mintShare(id, user.userId);
  }

  @Delete(':id/share')
  @UseGuards(RegisteredUserGuard)
  @HttpCode(204)
  @ApiOperation({ summary: "Revoke a custom map's share code" })
  async unshare(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.maps.revokeShare(id, user.userId);
  }

  @Get('shared/:code')
  @ApiOperation({ summary: 'Peek at a shared map by code (read-only; no ownership info)' })
  @ApiResponse({ status: 200, schema: apiSchema(SharedMapViewSchema) })
  peek(@Param('code') code: string) {
    return this.maps.peekByCode(code);
  }

  @Post('shared/:code/clone')
  @UseGuards(RegisteredUserGuard)
  @ApiOperation({ summary: 'Clone a shared map by code into your own map list' })
  @ApiResponse({ status: 201, schema: apiSchema(MapDetailSchema) })
  clone(@Param('code') code: string, @CurrentUser() user: AuthUser) {
    return this.maps.cloneByCode(code, user.userId);
  }

  @Get('content/:hash')
  @ApiOperation({ summary: 'Fetch published, immutable map content by contentHash' })
  @ApiResponse({ status: 200, schema: apiSchema(MapContentResponseSchema) })
  async content(@Param('hash') hash: string) {
    const doc = await this.maps.getContentByHash(hash);
    if (!doc) throw new NotFoundException('unknown content hash');
    return doc.content;
  }
}
