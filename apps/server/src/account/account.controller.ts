import { Body, Controller, Delete, HttpCode, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { REFRESH_COOKIE, REFRESH_PATH } from '../auth/auth.controller';
import { DeleteAccountDto, DeleteAccountSchema } from '../auth/auth.schemas';
import { apiSchema } from '../openapi/openapi';
import { AccountDeletionService } from './account-deletion.service';
import type { AuthUser } from '../auth/auth.types';

@ApiTags('auth')
@Controller('api/v1/auth')
export class AccountController {
  constructor(private readonly deletion: AccountDeletionService) {}

  @Delete('me')
  @HttpCode(204)
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Delete the current account (irreversible; revokes Apple tokens)' })
  @ApiBody({ schema: apiSchema(DeleteAccountSchema) })
  async deleteMe(
    @CurrentUser() user: AuthUser,
    @Body() body: DeleteAccountDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.deletion.deleteAccount(user, body.appleAuthorizationCode);
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
  }
}
