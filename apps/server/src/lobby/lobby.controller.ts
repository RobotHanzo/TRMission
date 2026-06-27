import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { LobbyService } from './lobby.service';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  CreateRoomDto,
  ReadyDto,
  CreateRoomSchema,
  ReadySchema,
  RoomViewSchema,
  TicketResultSchema,
} from './lobby.schemas';
import { apiSchema } from '../openapi/openapi';
import type { AuthUser } from '../auth/auth.types';

@ApiTags('lobby')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard)
@Controller('api/v1/rooms')
export class LobbyController {
  constructor(private readonly lobby: LobbyService) {}

  @Post()
  @ApiOperation({ summary: 'Create a room (you become the host)' })
  @ApiBody({ schema: apiSchema(CreateRoomSchema) })
  @ApiResponse({ status: 201, schema: apiSchema(RoomViewSchema) })
  create(@CurrentUser() user: AuthUser, @Body() body: CreateRoomDto) {
    return this.lobby.create(user, body.maxPlayers ?? 5);
  }

  @Get(':code')
  @ApiOperation({ summary: 'Get a room by code' })
  @ApiResponse({ status: 200, schema: apiSchema(RoomViewSchema) })
  get(@Param('code') code: string) {
    return this.lobby.get(code.toUpperCase());
  }

  @Post(':code/join')
  @HttpCode(200)
  @ApiOperation({ summary: 'Join a room' })
  @ApiResponse({ status: 200, schema: apiSchema(RoomViewSchema) })
  join(@CurrentUser() user: AuthUser, @Param('code') code: string) {
    return this.lobby.join(code.toUpperCase(), user);
  }

  @Post(':code/leave')
  @HttpCode(200)
  @ApiOperation({ summary: 'Leave a room' })
  @ApiResponse({ status: 200, schema: apiSchema(RoomViewSchema) })
  leave(@CurrentUser() user: AuthUser, @Param('code') code: string) {
    return this.lobby.leave(code.toUpperCase(), user);
  }

  @Post(':code/ready')
  @HttpCode(200)
  @ApiOperation({ summary: 'Set your ready flag' })
  @ApiBody({ schema: apiSchema(ReadySchema) })
  @ApiResponse({ status: 200, schema: apiSchema(RoomViewSchema) })
  ready(@CurrentUser() user: AuthUser, @Param('code') code: string, @Body() body: ReadyDto) {
    return this.lobby.ready(code.toUpperCase(), user, body.ready);
  }

  @Post(':code/start')
  @HttpCode(200)
  @ApiOperation({ summary: 'Host starts the game; returns your ws-game ticket' })
  @ApiResponse({ status: 200, schema: apiSchema(TicketResultSchema) })
  start(@CurrentUser() user: AuthUser, @Param('code') code: string) {
    return this.lobby.start(code.toUpperCase(), user);
  }

  @Post(':code/ticket')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mint a ws-game ticket for the active game (initial / reconnect)' })
  @ApiResponse({ status: 200, schema: apiSchema(TicketResultSchema) })
  ticket(@CurrentUser() user: AuthUser, @Param('code') code: string) {
    return this.lobby.ticket(code.toUpperCase(), user);
  }
}
