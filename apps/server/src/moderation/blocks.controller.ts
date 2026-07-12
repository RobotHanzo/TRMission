import {
  BadRequestException,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { UserRepo } from '../auth/user.repo';
import { apiSchema } from '../openapi/openapi';
import { BlockListSchema } from './moderation.schemas';
import type { AuthUser } from '../auth/auth.types';

/**
 * The account's client-side mute list (Apple 1.2 / Play UGC "block abusive users").
 * Server-stored so it follows the user across devices; enforcement is client display
 * filtering only — blocking never alters seating, matchmaking, or game state.
 */
@ApiTags('moderation')
@Controller('api/v1/me/blocks')
@UseGuards(AccessTokenGuard)
@ApiBearerAuth('access-token')
export class BlocksController {
  constructor(private readonly users: UserRepo) {}

  @Get()
  @ApiOperation({ summary: "The signed-in account's blocked-user ids" })
  @ApiResponse({ status: 200, schema: apiSchema(BlockListSchema) })
  async list(@CurrentUser() user: AuthUser) {
    return { blockedUserIds: await this.users.listBlockedUsers(user.userId) };
  }

  @Put(':userId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Block (mute) a user. Idempotent.' })
  async add(@CurrentUser() user: AuthUser, @Param('userId') targetId: string): Promise<void> {
    if (targetId === user.userId) throw new BadRequestException('cannot block yourself');
    if (!(await this.users.findById(targetId))) throw new NotFoundException('user not found');
    if (!(await this.users.addBlockedUser(user.userId, targetId))) {
      throw new ConflictException('block list full');
    }
  }

  @Delete(':userId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Unblock a user. Idempotent.' })
  async remove(@CurrentUser() user: AuthUser, @Param('userId') targetId: string): Promise<void> {
    await this.users.removeBlockedUser(user.userId, targetId);
  }
}
