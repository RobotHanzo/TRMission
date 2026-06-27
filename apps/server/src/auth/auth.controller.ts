import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { randomInt } from 'node:crypto';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AccessTokenGuard } from './access-token.guard';
import { CurrentUser } from './current-user.decorator';
import {
  GuestDto,
  RegisterDto,
  UpgradeDto,
  LoginDto,
  UpdatePreferencesDto,
  GuestSchema,
  RegisterSchema,
  UpgradeSchema,
  LoginSchema,
  PreferencesSchema,
  AuthResultSchema,
  AccessResultSchema,
  PublicUserSchema,
} from './auth.schemas';
import { apiSchema } from '../openapi/openapi';
import { env } from '../config/env';
import type { AuthUser, IssuedAuth } from './auth.types';

const REFRESH_COOKIE = 'trm_refresh';
const REFRESH_PATH = '/api/v1/auth';
const randomGuestName = (): string => `旅客${randomInt(1000, 10000)}`;

@ApiTags('auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private setRefresh(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: env.cookieSecure,
      sameSite: 'strict',
      path: REFRESH_PATH,
      maxAge: env.refreshTtlMs,
    });
  }

  private finish(
    res: Response,
    issued: IssuedAuth,
  ): { user: IssuedAuth['user']; accessToken: string } {
    this.setRefresh(res, issued.refreshToken);
    return { user: issued.user, accessToken: issued.accessToken };
  }

  @Post('guest')
  @ApiOperation({ summary: 'Create a guest session (play instantly)' })
  @ApiBody({ schema: apiSchema(GuestSchema) })
  @ApiResponse({ status: 201, schema: apiSchema(AuthResultSchema) })
  async guest(@Body() body: GuestDto, @Res({ passthrough: true }) res: Response) {
    return this.finish(
      res,
      await this.auth.guest(body.displayName ?? randomGuestName(), body.locale ?? 'zh-Hant'),
    );
  }

  @Post('register')
  @ApiOperation({ summary: 'Register a new account' })
  @ApiBody({ schema: apiSchema(RegisterSchema) })
  @ApiResponse({ status: 201, schema: apiSchema(AuthResultSchema) })
  async register(@Body() body: RegisterDto, @Res({ passthrough: true }) res: Response) {
    return this.finish(
      res,
      await this.auth.register(
        body.email,
        body.password,
        body.displayName,
        body.locale ?? 'zh-Hant',
      ),
    );
  }

  @Post('upgrade')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Attach credentials to the current guest (keeps stats)' })
  @ApiBody({ schema: apiSchema(UpgradeSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(AuthResultSchema) })
  async upgrade(
    @CurrentUser() user: AuthUser,
    @Body() body: UpgradeDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.finish(res, await this.auth.upgrade(user.userId, body.email, body.password));
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log in with email + password' })
  @ApiBody({ schema: apiSchema(LoginSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(AuthResultSchema) })
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.finish(res, await this.auth.login(body.email, body.password));
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the refresh cookie and mint a new access token' })
  @ApiResponse({ status: 200, schema: apiSchema(AccessResultSchema) })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE]);
    this.setRefresh(res, result.refreshToken);
    return { accessToken: result.accessToken };
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the refresh family and clear the cookie' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Current user profile' })
  @ApiResponse({ status: 200, schema: apiSchema(PublicUserSchema) })
  async me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.userId);
  }

  @Patch('me/preferences')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update display preferences (theme, colour-blind)' })
  @ApiBody({ schema: apiSchema(PreferencesSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(PublicUserSchema) })
  async updatePreferences(@CurrentUser() user: AuthUser, @Body() body: UpdatePreferencesDto) {
    return this.auth.updatePreferences(user.userId, body);
  }
}
