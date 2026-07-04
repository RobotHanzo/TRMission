import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { randomInt } from 'node:crypto';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AccessTokenGuard } from './access-token.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthConfig, OAUTH_PROVIDERS, type OauthProvider } from './auth-config';
import { OauthService } from './oauth.service';
import {
  GuestDto,
  RegisterDto,
  UpgradeDto,
  LoginDto,
  GoogleCredentialDto,
  UpdatePreferencesDto,
  GuestSchema,
  RegisterSchema,
  UpgradeSchema,
  LoginSchema,
  GoogleCredentialSchema,
  PreferencesSchema,
  AuthResultSchema,
  AccessResultSchema,
  AuthConfigSchema,
  PublicUserSchema,
} from './auth.schemas';
import { apiSchema } from '../openapi/openapi';
import { env } from '../config/env';
import type { AuthUser, IssuedAuth } from './auth.types';

const REFRESH_COOKIE = 'trm_refresh';
const REFRESH_PATH = '/api/v1/auth';
// CSRF nonce for the OAuth round-trip. SameSite=Lax (NOT Strict): the provider callback is a
// cross-site top-level navigation, on which Strict cookies would be withheld — breaking every
// callback. Scoped to the oauth subtree so it never rides along with ordinary auth calls.
const OAUTH_NONCE_COOKIE = 'trm_oauth';
const OAUTH_NONCE_PATH = '/api/v1/auth/oauth';
const randomGuestName = (): string => `旅客${randomInt(1000, 10000)}`;
const asProvider = (p: string): OauthProvider | null =>
  (OAUTH_PROVIDERS as readonly string[]).includes(p) ? (p as OauthProvider) : null;

@ApiTags('auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly authConfig: AuthConfig,
    private readonly oauth: OauthService,
  ) {}

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

  @Get('config')
  @ApiOperation({ summary: 'Which sign-in methods are enabled (UI hint)' })
  @ApiResponse({ status: 200, schema: apiSchema(AuthConfigSchema) })
  config() {
    return this.authConfig.publicConfig();
  }

  @Post('guest')
  @ApiOperation({ summary: 'Create a guest session (play instantly)' })
  @ApiBody({ schema: apiSchema(GuestSchema) })
  @ApiResponse({ status: 201, schema: apiSchema(AuthResultSchema) })
  async guest(@Body() body: GuestDto, @Res({ passthrough: true }) res: Response) {
    if (!this.authConfig.guest) throw new ForbiddenException('guest sign-in disabled');
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
    if (!this.authConfig.passwordLogin) throw new ForbiddenException('password login disabled');
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
    if (!this.authConfig.passwordLogin) throw new ForbiddenException('password login disabled');
    return this.finish(res, await this.auth.upgrade(user.userId, body.email, body.password));
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log in with email + password' })
  @ApiBody({ schema: apiSchema(LoginSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(AuthResultSchema) })
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    if (!this.authConfig.passwordLogin) throw new ForbiddenException('password login disabled');
    return this.finish(res, await this.auth.login(body.email, body.password));
  }

  @Post('oauth/google/credential')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in via a Google One Tap / rendered-button ID token' })
  @ApiBody({ schema: apiSchema(GoogleCredentialSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(AuthResultSchema) })
  async googleCredential(
    @Body() body: GoogleCredentialDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.authConfig.provider('google')) throw new ForbiddenException('google sign-in disabled');
    const guestUserId = await this.oauth.guestIdFromRefresh(req.cookies?.[REFRESH_COOKIE]);
    return this.finish(res, await this.oauth.handleCredential(body.credential, guestUserId));
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
  @ApiOperation({ summary: 'Update display preferences (theme, colour-blind, language, layout)' })
  @ApiBody({ schema: apiSchema(PreferencesSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(PublicUserSchema) })
  async updatePreferences(@CurrentUser() user: AuthUser, @Body() body: UpdatePreferencesDto) {
    return this.auth.updatePreferences(user.userId, body);
  }

  // ── OAuth (browser navigations, not JSON — excluded from the OpenAPI doc) ──────────────────
  // Both routes are unguarded: the user is not yet authenticated. Identity is carried through the
  // provider in a signed `state`, bound to this browser by the `trm_oauth` nonce cookie.

  @Get('oauth/:provider/start')
  @ApiExcludeEndpoint()
  async oauthStart(
    @Param('provider') providerParam: string,
    @Query('redirect') redirect: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const provider = asProvider(providerParam);
    if (!provider || !this.authConfig.provider(provider)) {
      res.redirect(this.authConfig.webCallback({ error: 'provider_disabled' }));
      return;
    }
    // A logged-in guest (identified from the refresh cookie, which IS sent on this same-site
    // navigation) is carried into the flow so the callback can upgrade them in place.
    const guestUserId = await this.oauth.guestIdFromRefresh(req.cookies?.[REFRESH_COOKIE]);
    const built = this.oauth.buildAuthorize(provider, redirect, guestUserId);
    if (!built) {
      res.redirect(this.authConfig.webCallback({ error: 'provider_disabled' }));
      return;
    }
    res.cookie(OAUTH_NONCE_COOKIE, built.nonce, {
      httpOnly: true,
      secure: env.cookieSecure,
      sameSite: 'lax',
      path: OAUTH_NONCE_PATH,
      maxAge: env.oauthStateTtlMs, // same lifetime as the signed state it guards
    });
    res.redirect(built.url);
  }

  @Get('oauth/:provider/callback')
  @ApiExcludeEndpoint()
  async oauthCallback(
    @Param('provider') providerParam: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    res.clearCookie(OAUTH_NONCE_COOKIE, { path: OAUTH_NONCE_PATH });
    const provider = asProvider(providerParam);
    if (!provider) {
      res.redirect(this.authConfig.webCallback({ error: 'provider_disabled' }));
      return;
    }
    const result = await this.oauth.handleCallback(
      provider,
      code,
      state,
      req.cookies?.[OAUTH_NONCE_COOKIE],
    );
    if (!result.ok) {
      res.redirect(this.authConfig.webCallback({ redirect: result.redirect, error: result.error }));
      return;
    }
    this.setRefresh(res, result.issued.refreshToken);
    res.redirect(this.authConfig.webCallback({ redirect: result.redirect }));
  }
}
