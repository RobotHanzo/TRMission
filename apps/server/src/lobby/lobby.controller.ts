import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { LobbyService } from './lobby.service';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  CreateRoomDto,
  ReadyDto,
  AddBotDto,
  UpdateSettingsDto,
  RematchVoteDto,
  CreateRoomSchema,
  ReadySchema,
  AddBotSchema,
  UpdateSettingsSchema,
  RematchVoteSchema,
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

  // Declared before ':code' so the literal path is matched here, not captured as a room code.
  @Get('mine')
  @ApiOperation({ summary: 'List your active rooms (lobbies + live games you can rejoin)' })
  @ApiResponse({ status: 200, schema: apiSchema(z.array(RoomViewSchema)) })
  mine(@CurrentUser() user: AuthUser) {
    return this.lobby.listMine(user);
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

  @Post(':code/rematch-vote')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cast (or change) your advisory "play again" vote' })
  @ApiBody({ schema: apiSchema(RematchVoteSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(RoomViewSchema) })
  rematchVote(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Body() body: RematchVoteDto,
  ) {
    return this.lobby.voteRematch(code.toUpperCase(), user, body.wantsRematch);
  }

  @Post(':code/bots')
  @HttpCode(200)
  @ApiOperation({ summary: 'Host adds a bot player of a given difficulty' })
  @ApiBody({ schema: apiSchema(AddBotSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(RoomViewSchema) })
  addBot(@CurrentUser() user: AuthUser, @Param('code') code: string, @Body() body: AddBotDto) {
    return this.lobby.addBot(code.toUpperCase(), user, body.difficulty);
  }

  @Post(':code/bots/:botId/remove')
  @HttpCode(200)
  @ApiOperation({ summary: 'Host removes a bot player' })
  @ApiResponse({ status: 200, schema: apiSchema(RoomViewSchema) })
  removeBot(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Param('botId') botId: string,
  ) {
    return this.lobby.removeBot(code.toUpperCase(), user, botId);
  }

  @Post(':code/kick/:userId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Host removes another player from the room' })
  @ApiResponse({ status: 200, schema: apiSchema(RoomViewSchema) })
  kick(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Param('userId') userId: string,
  ) {
    return this.lobby.kick(code.toUpperCase(), user, userId);
  }

  @Patch(':code/settings')
  @HttpCode(200)
  @ApiOperation({ summary: 'Host updates per-game settings (LOBBY only)' })
  @ApiBody({ schema: apiSchema(UpdateSettingsSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(RoomViewSchema) })
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Body() body: UpdateSettingsDto,
  ) {
    return this.lobby.updateSettings(code.toUpperCase(), user, body);
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

  @Post(':code/spectate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mint a spectator ws-ticket for a live game (if spectating is allowed)',
  })
  @ApiResponse({ status: 200, schema: apiSchema(TicketResultSchema) })
  spectate(@CurrentUser() user: AuthUser, @Param('code') code: string) {
    return this.lobby.spectateTicket(code.toUpperCase(), user);
  }
}
