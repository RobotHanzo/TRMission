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
  UnauthorizedException,
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
import { clientIp } from './client-ip';
import { AccessTokenGuard } from './access-token.guard';
import { MobileCodeRepo } from './mobile-code.repo';
import { UserRepo } from './user.repo';
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
  RefreshDto,
  LogoutDto,
  RefreshSchema,
  LogoutSchema,
  MobileExchangeDto,
  MobileExchangeSchema,
  MobileCarryResultSchema,
  MobileAuthResultSchema,
  AppleCredentialDto,
  AppleCredentialSchema,
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
  FeatureIntroSeenDto,
  FeatureIntroSeenSchema,
} from './auth.schemas';
import { apiSchema } from '../openapi/openapi';
import { env } from '../config/env';
import type { AuthUser, IssuedAuth } from './auth.types';

export const REFRESH_COOKIE = 'trm_refresh';
export const REFRESH_PATH = '/api/v1/auth';
// CSRF nonce for the OAuth round-trip. SameSite=Lax (NOT Strict): the provider callback is a
// cross-site top-level navigation, on which Strict cookies would be withheld — breaking every
// callback. Scoped to the oauth subtree so it never rides along with ordinary auth calls.
const OAUTH_NONCE_COOKIE = 'trm_oauth';
// Apple's form_post callback is a cross-site POST — even Lax is withheld there, so the SIWA
// redirect flow uses its own SameSite=None (HTTPS-only) nonce cookie. Separate name so an
// in-flight Google/Discord round-trip is never clobbered by an Apple one (or vice versa).
const APPLE_NONCE_COOKIE = 'trm_oauth_apple';
const OAUTH_NONCE_PATH = '/api/v1/auth/oauth';
const randomGuestName = (): string => `旅客${randomInt(1000, 10000)}`;
/** Exchange codes only need to survive the 302 → app-open → POST hop. */
const EXCHANGE_CODE_TTL_MS = 60_000;
const asProvider = (p: string): OauthProvider | null =>
  (OAUTH_PROVIDERS as readonly string[]).includes(p) ? (p as OauthProvider) : null;

@ApiTags('auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly authConfig: AuthConfig,
    private readonly oauth: OauthService,
    private readonly mobileCodes: MobileCodeRepo,
    private readonly users: UserRepo,
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

  /** Native clients cannot use SameSite cookies; they self-identify with this header. */
  private isMobile(req: Request): boolean {
    return req.headers['x-trm-client'] === 'mobile';
  }

  private finish(
    req: Request,
    res: Response,
    issued: IssuedAuth,
  ): { user: IssuedAuth['user']; accessToken: string; refreshToken?: string } {
    if (this.isMobile(req)) {
      // Token-in-body transport: the refresh token goes to Keychain/Keystore, never a cookie.
      return {
        user: issued.user,
        accessToken: issued.accessToken,
        refreshToken: issued.refreshToken,
      };
    }
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
  async guest(
    @Body() body: GuestDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.authConfig.guest) throw new ForbiddenException('guest sign-in disabled');
    return this.finish(
      req,
      res,
      await this.auth.guest(
        body.displayName ?? randomGuestName(),
        body.locale ?? 'zh-Hant',
        clientIp(req),
      ),
    );
  }

  @Post('register')
  @ApiOperation({ summary: 'Register a new account' })
  @ApiBody({ schema: apiSchema(RegisterSchema) })
  @ApiResponse({ status: 201, schema: apiSchema(AuthResultSchema) })
  async register(
    @Body() body: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.authConfig.passwordLogin) throw new ForbiddenException('password login disabled');
    return this.finish(
      req,
      res,
      await this.auth.register(
        body.email,
        body.password,
        body.displayName,
        body.locale ?? 'zh-Hant',
        clientIp(req),
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
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.authConfig.passwordLogin) throw new ForbiddenException('password login disabled');
    return this.finish(
      req,
      res,
      await this.auth.upgrade(user.userId, body.email, body.password, clientIp(req)),
    );
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log in with email + password' })
  @ApiBody({ schema: apiSchema(LoginSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(AuthResultSchema) })
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.authConfig.passwordLogin) throw new ForbiddenException('password login disabled');
    return this.finish(req, res, await this.auth.login(body.email, body.password, clientIp(req)));
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
    if (!this.authConfig.provider('google'))
      throw new ForbiddenException('google sign-in disabled');
    const guestUserId = await this.oauth.guestIdFromRefresh(
      body.refreshToken ?? req.cookies?.[REFRESH_COOKIE],
    );
    return this.finish(
      req,
      res,
      await this.oauth.handleCredential(body.credential, guestUserId, clientIp(req)),
    );
  }

  @Post('oauth/apple/credential')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with Apple via a native identity token' })
  @ApiBody({ schema: apiSchema(AppleCredentialSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(AuthResultSchema) })
  async appleCredential(
    @Body() body: AppleCredentialDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.authConfig.appleEnabled) throw new ForbiddenException('apple sign-in disabled');
    const guestUserId = await this.oauth.guestIdFromRefresh(
      body.refreshToken ?? req.cookies?.[REFRESH_COOKIE],
    );
    return this.finish(
      req,
      res,
      await this.oauth.handleAppleCredential(
        body.identityToken,
        body.fullName,
        guestUserId,
        clientIp(req),
      ),
    );
  }

  @Post('mobile/carry')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary:
      'Mint a single-use carry code: mobile OAuth guest-upgrade, or the builder-WebView web-session handoff',
  })
  @ApiResponse({ status: 201, schema: apiSchema(MobileCarryResultSchema) })
  async mobileCarry(@CurrentUser() user: AuthUser) {
    return { code: await this.mobileCodes.mint('carry', user.userId, env.oauthStateTtlMs) };
  }

  @Post('mobile/exchange')
  @HttpCode(200)
  @ApiOperation({ summary: 'Redeem a one-time OAuth code for a mobile token pair' })
  @ApiBody({ schema: apiSchema(MobileExchangeSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(MobileAuthResultSchema) })
  async mobileExchange(@Body() body: MobileExchangeDto, @Req() req: Request) {
    const userId = await this.mobileCodes.redeem('exchange', body.code);
    if (!userId) throw new UnauthorizedException('invalid or expired code');
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('user not found');
    const issued = await this.auth.issueFor(user, clientIp(req));
    return {
      user: issued.user,
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
    };
  }

  /**
   * Builder-WebView session handoff (browser navigation, not JSON). The app minted a
   * single-use carry code over Bearer (POST /auth/mobile/carry); redeeming it here mints a
   * NEW web session family and sets the normal Strict refresh cookie, then lands on /maps.
   * The app's own body-token family is never touched. Errors redirect (never 500 a
   * top-level navigation) with no cookie.
   */
  @Get('mobile-web-handoff')
  @ApiExcludeEndpoint()
  async mobileWebHandoff(
    @Query('code') code: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const userId = await this.mobileCodes.redeem('carry', code);
    const user = userId ? await this.users.findById(userId) : null;
    if (!user) {
      res.redirect(this.authConfig.webCallback({ error: 'invalid_code' }));
      return;
    }
    try {
      const issued = await this.auth.issueFor(user, clientIp(req));
      this.setRefresh(res, issued.refreshToken);
      res.redirect(`${this.authConfig.redirectBase}/maps`);
    } catch {
      // e.g. account disabled between mint and redeem.
      res.redirect(this.authConfig.webCallback({ error: 'server_error' }));
    }
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the refresh token (cookie for web, body for mobile)' })
  @ApiBody({ schema: apiSchema(RefreshSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(AccessResultSchema) })
  async refresh(
    @Body() body: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const bodyToken = body.refreshToken;
    const result = await this.auth.refresh(bodyToken ?? req.cookies?.[REFRESH_COOKIE]);
    if (bodyToken) {
      // Body-in → body-out; never downgrade a mobile session onto a cookie.
      return { accessToken: result.accessToken, refreshToken: result.refreshToken };
    }
    this.setRefresh(res, result.refreshToken);
    return { accessToken: result.accessToken };
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Revoke the refresh family (cookie or body token) and clear the cookie',
  })
  @ApiBody({ schema: apiSchema(LogoutSchema) })
  async logout(
    @Body() body: LogoutDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(body.refreshToken ?? req.cookies?.[REFRESH_COOKIE]);
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

  @Post('me/tutorial-completed')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Mark the guided tutorial as completed for the current user' })
  @ApiResponse({ status: 200, schema: apiSchema(PublicUserSchema) })
  async completeTutorial(@CurrentUser() user: AuthUser) {
    return this.auth.completeTutorial(user.userId);
  }

  @Post('me/feature-intros')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Record that a map-feature intro was shown to the current user' })
  @ApiBody({ schema: apiSchema(FeatureIntroSeenSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(PublicUserSchema) })
  async markFeatureIntroSeen(@CurrentUser() user: AuthUser, @Body() body: FeatureIntroSeenDto) {
    return this.auth.markFeatureIntroSeen(user.userId, body.feature);
  }

  // ── OAuth (browser navigations, not JSON — excluded from the OpenAPI doc) ──────────────────
  // Both routes are unguarded: the user is not yet authenticated. Identity is carried through the
  // provider in a signed `state`, bound to this browser by the `trm_oauth` nonce cookie.

  // ── Sign in with Apple: the web/Android redirect flow ──────────────────────────────────────
  // Declared BEFORE the generic :provider routes so Nest matches these first (asProvider still
  // rejects 'apple' — Apple deliberately stays outside OAUTH_PROVIDERS because it diverges from
  // the shared PKCE+userinfo machinery: per-request ES256 client_secret, identity from the
  // id_token, and a response_mode=form_post callback that arrives as a CROSS-SITE POST). The
  // nonce cookie is therefore SameSite=None (a Lax cookie never rides a cross-site POST), under
  // its own name so an in-flight Google/Discord round-trip is never clobbered.

  @Get('oauth/apple/start')
  @ApiExcludeEndpoint()
  async appleStart(
    @Query('redirect') redirect: string | undefined,
    @Query('client') client: string | undefined,
    @Query('carry') carry: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const mobile = client === 'mobile';
    const failUrl = (error: string): string =>
      mobile ? this.authConfig.mobileCallback({ error }) : this.authConfig.webCallback({ error });
    if (!this.authConfig.appleRedirectEnabled) {
      res.redirect(failUrl('provider_disabled'));
      return;
    }
    const guestUserId = mobile
      ? await this.oauth.guestIdFromCarryCode(carry)
      : await this.oauth.guestIdFromRefresh(req.cookies?.[REFRESH_COOKIE]);
    const built = this.oauth.buildAppleAuthorize(redirect, guestUserId, mobile);
    if (!built) {
      res.redirect(failUrl('provider_disabled'));
      return;
    }
    // SameSite=None only sticks as Secure — over dev http browsers drop it and the signed state
    // alone binds the round-trip (see handleAppleRedirectCallback's nonce rule).
    res.cookie(APPLE_NONCE_COOKIE, built.nonce, {
      httpOnly: true,
      secure: env.cookieSecure,
      sameSite: env.cookieSecure ? 'none' : 'lax',
      path: OAUTH_NONCE_PATH,
      maxAge: env.oauthStateTtlMs, // same lifetime as the signed state it guards
    });
    res.redirect(built.url);
  }

  @Post('oauth/apple/callback')
  @ApiExcludeEndpoint()
  async appleCallback(
    @Body('code') code: string | undefined,
    @Body('state') state: string | undefined,
    @Body('user') userField: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const nonceCookie = req.cookies?.[APPLE_NONCE_COOKIE] as string | undefined;
    res.clearCookie(APPLE_NONCE_COOKIE, { path: OAUTH_NONCE_PATH });
    const result = await this.oauth.handleAppleRedirectCallback(
      code,
      state,
      userField,
      nonceCookie,
      env.cookieSecure,
    );
    if (!result.ok) {
      res.redirect(
        result.mobile
          ? this.authConfig.mobileCallback({ error: result.error })
          : this.authConfig.webCallback({ redirect: result.redirect, error: result.error }),
      );
      return;
    }
    if (result.mobile) {
      // No cookie can survive the system-browser → app hop; hand off a single-use code instead.
      const exchangeCode = await this.mobileCodes.mint(
        'exchange',
        result.user._id,
        EXCHANGE_CODE_TTL_MS,
      );
      res.redirect(this.authConfig.mobileCallback({ code: exchangeCode }));
      return;
    }
    try {
      const issued = await this.auth.issueFor(result.user, clientIp(req));
      this.setRefresh(res, issued.refreshToken);
      res.redirect(this.authConfig.webCallback({ redirect: result.redirect }));
    } catch {
      // e.g. account disabled between resolution and issuance — never 500 a top-level navigation.
      res.redirect(
        this.authConfig.webCallback({ redirect: result.redirect, error: 'server_error' }),
      );
    }
  }

  @Get('oauth/:provider/start')
  @ApiExcludeEndpoint()
  async oauthStart(
    @Param('provider') providerParam: string,
    @Query('redirect') redirect: string | undefined,
    @Query('client') client: string | undefined,
    @Query('carry') carry: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const provider = asProvider(providerParam);
    const mobile = client === 'mobile';
    if (!provider || !this.authConfig.provider(provider)) {
      res.redirect(
        mobile
          ? this.authConfig.mobileCallback({ error: 'provider_disabled' })
          : this.authConfig.webCallback({ error: 'provider_disabled' }),
      );
      return;
    }
    // A logged-in guest is carried into the flow so the callback can upgrade them in place.
    // Web: identified from the refresh cookie (sent on this same-site navigation). Mobile:
    // the system browser holds no app session — the app pre-minted a single-use carry code.
    const guestUserId = mobile
      ? await this.oauth.guestIdFromCarryCode(carry)
      : await this.oauth.guestIdFromRefresh(req.cookies?.[REFRESH_COOKIE]);
    const built = this.oauth.buildAuthorize(provider, redirect, guestUserId, mobile);
    if (!built) {
      res.redirect(
        mobile
          ? this.authConfig.mobileCallback({ error: 'provider_disabled' })
          : this.authConfig.webCallback({ error: 'provider_disabled' }),
      );
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
      res.redirect(
        result.mobile
          ? this.authConfig.mobileCallback({ error: result.error })
          : this.authConfig.webCallback({ redirect: result.redirect, error: result.error }),
      );
      return;
    }
    if (result.mobile) {
      // No cookie can survive the system-browser → app hop; hand off a single-use code instead.
      const exchangeCode = await this.mobileCodes.mint(
        'exchange',
        result.user._id,
        EXCHANGE_CODE_TTL_MS,
      );
      res.redirect(this.authConfig.mobileCallback({ code: exchangeCode }));
      return;
    }
    try {
      const issued = await this.auth.issueFor(result.user, clientIp(req));
      this.setRefresh(res, issued.refreshToken);
      res.redirect(this.authConfig.webCallback({ redirect: result.redirect }));
    } catch {
      // e.g. account disabled between resolution and issuance — never 500 a top-level navigation.
      res.redirect(
        this.authConfig.webCallback({ redirect: result.redirect, error: 'server_error' }),
      );
    }
  }
}
