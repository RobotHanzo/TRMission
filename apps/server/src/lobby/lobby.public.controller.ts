import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { LobbyService } from './lobby.service';
import { apiSchema } from '../openapi/openapi';
import { RoomViewSchema } from './lobby.schemas';

// Unauthenticated: the home screen shows public rooms to everyone (guests included). Registered
// BEFORE LobbyController so `GET /rooms/public` is matched here and never captured by the guarded
// `GET /rooms/:code` route.
@ApiTags('lobby')
@Controller('api/v1/rooms')
export class LobbyPublicController {
  constructor(private readonly lobby: LobbyService) {}

  @Get('public')
  @ApiOperation({ summary: 'List public rooms (lobbies to join + live games to watch)' })
  @ApiResponse({ status: 200, schema: apiSchema(z.array(RoomViewSchema)) })
  list() {
    return this.lobby.listPublic();
  }
}
